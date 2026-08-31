import { sql } from "drizzle-orm";
import { date, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { alertes } from "./alertes";
import { appartements } from "./appartements";
import { baux } from "./baux";
import { bien } from "./bien";
import { auditColumns } from "./columns.helpers";
import { locataires } from "./locataires";
import { organisations } from "./organisations";

// Sous-ensemble des types d'alerte (packages/db/src/schema/alertes.ts) qui
// génèrent une tâche à ce stade (Module Tâches, Étape 1, docs/backlog.md) :
// bail_fin_proche et document_expire_proche sont volontairement exclus
// (décision explicite, pas un oubli — l'alerte seule suffit pour l'instant).
// quittance_mensuelle/revision_loyer/autre sont posés dès maintenant pour
// éviter une migration de plus, mais aucune logique ne les produit encore.
export const tacheTypeEnum = pgEnum("tache_type", [
  "impaye",
  "entretien_equipement",
  "document_expire",
  "quittance_mensuelle",
  "revision_loyer",
  "autre"
]);

// Cycle de vie propre à Tâches, distinct de celui d'alertes
// (active/traitee/ignoree/resolue) — pas de state machine partagée avec
// synchroniserAlerte/calculerActionAlerte (docs/backlog.md, Module Tâches).
export const tacheStatutEnum = pgEnum("tache_statut", ["a_faire", "en_cours", "fait", "annulee"]);

export const tacheOrigineEnum = pgEnum("tache_origine", ["alerte", "planifiee", "manuelle"]);

export const tache = pgTable(
  "tache",
  {
    ...auditColumns,
    type: tacheTypeEnum("type").notNull(),
    statut: tacheStatutEnum("statut").notNull().default("a_faire"),
    origine: tacheOrigineEnum("origine").notNull(),
    // Référence l'alerte à l'origine de la tâche — uniquement pour
    // origine='alerte'. Sert de clé d'idempotence (voir l'index unique
    // partiel ci-dessous) : le job quotidien ne doit jamais créer une
    // deuxième tâche active pour la même alerte.
    alerteSourceId: uuid("alerte_source_id").references(() => alertes.id),
    bailId: uuid("bail_id").references(() => baux.id),
    appartementId: uuid("appartement_id").references(() => appartements.id),
    // Pour une tâche résolue au niveau du bien lui-même (ex. document
    // expiré attaché à documents.entiteType='bien'), pas à un appartement
    // ou un bail précis — voir TachesJobService.genererTachesDepuisAlertes.
    bienId: uuid("bien_id").references(() => bien.id),
    // Non peuplé par la génération automatique dans cette étape (pas de
    // règle de choix arbitrée pour un bail en colocation via
    // bail_locataires, relation many-to-many) — réservé à un usage futur.
    locataireId: uuid("locataire_id").references(() => locataires.id),
    dateEcheance: date("date_echeance"),
    dateCompletion: timestamp("date_completion", { withTimezone: true }),
    // Ex. '2026-09' — inutilisé dans cette étape, réservé aux tâches
    // récurrentes futures (quittances mensuelles, révision de loyer).
    periodeRecurrence: text("periode_recurrence"),
    notes: text("notes"),
    metadata: jsonb("metadata"),
    // Scoping multi-tenant direct, même principe que bien.organisationId —
    // résolu à la création depuis le bien concerné (via appartement.bienId
    // ou directement bienId), jamais transmis par le client.
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id)
  },
  (table) => [
    // Idempotence : au plus une tâche a_faire/en_cours à la fois par
    // alerte source — le job quotidien s'appuie dessus pour ne jamais
    // dupliquer une tâche déjà ouverte (voir genererTachesDepuisAlertes).
    uniqueIndex("tache_alerte_source_active_unique")
      .on(table.alerteSourceId)
      .where(sql`${table.statut} IN ('a_faire', 'en_cours') AND ${table.alerteSourceId} IS NOT NULL`),
    // Même principe, pour les tâches de révision de loyer (origine='planifiee',
    // pas d'alerte source) : au plus une tâche a_faire/en_cours par (bail,
    // période). Scopé à type='revision_loyer' pour ne jamais interférer avec
    // un bail_id posé par un autre type de tâche (impaye, document_expire) —
    // voir TachesJobService.genererTachesRevisionLoyer.
    uniqueIndex("tache_bail_periode_revision_active_unique")
      .on(table.bailId, table.periodeRecurrence)
      .where(
        sql`${table.type} = 'revision_loyer' AND ${table.statut} IN ('a_faire', 'en_cours') AND ${table.bailId} IS NOT NULL AND ${table.periodeRecurrence} IS NOT NULL`
      )
  ]
);
