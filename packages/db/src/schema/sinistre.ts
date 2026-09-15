import { date, numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { appartements } from "./appartements";
import { bien } from "./bien";
import { auditColumns } from "./columns.helpers";
import { contact } from "./contact";
import { organisations } from "./organisations";

// Module Suivi sinistre et assurance (2026-09-16). Objectif principal :
// détecter la stagnation d'un dossier (voir alertes.ts, type
// 'sinistre_stagnation') pour générer une relance vers l'assureur — pas
// un simple journal de sinistres.
export const sinistreTypeEnum = pgEnum("sinistre_type", [
  "degat_eaux",
  "incendie",
  "vol",
  "bris_de_glace",
  "catastrophe_naturelle",
  "autre"
]);

export const sinistreStatutEnum = pgEnum("sinistre_statut", [
  "declare",
  "expertise_planifiee",
  "expertise_realisee",
  "indemnise",
  "clos"
]);

export const sinistre = pgTable("sinistre", {
  ...auditColumns,
  type: sinistreTypeEnum("type").notNull(),
  statut: sinistreStatutEnum("statut").notNull().default("declare"),
  // Mis à jour à chaque changement RÉEL de statut (SinistresService.update
  // — jamais si le statut soumis est identique à l'actuel), jamais par une
  // valeur par défaut de colonne recalculée à chaque UPDATE. Seule donnée
  // que lit calculerAlerteSinistreStagnation (packages/core) : délai fixe
  // et identique quel que soit le statut, décision actée avec Jimmy — pas
  // de seuil différent par statut.
  dateChangementStatut: timestamp("date_changement_statut", { withTimezone: true }).notNull().defaultNow(),
  bienId: uuid("bien_id").references(() => bien.id),
  appartementId: uuid("appartement_id").references(() => appartements.id),
  // Assureur/expert en charge du dossier — rôle 'assureur' déjà présent
  // sur contact.role (Carnet de contacts), aucun nouveau concept introduit.
  // Nullable : renseignable après la déclaration initiale. Sans lui, la
  // tâche de relance générée par la stagnation se crée quand même mais
  // sans destinataire résolu (même principe que document_expire attaché à
  // un bien sans bail — TachesJobService.construireMetadataNotification,
  // "notification indisponible" plutôt qu'un blocage).
  contactAssureurId: uuid("contact_assureur_id").references(() => contact.id),
  dateDeclaration: date("date_declaration").notNull(),
  description: text("description"),
  montantReclame: numeric("montant_reclame", { precision: 10, scale: 2 }),
  // Purement informatif — décision explicite (2026-09-16) : jamais de
  // lien automatique vers Charges et fiscalité (revenu/dépense), le
  // traitement fiscal d'une indemnisation est incertain et ne doit jamais
  // être deviné. Une éventuelle écriture dans ce module reste un geste
  // manuel séparé, comme la création d'un bail depuis un candidat converti.
  montantIndemnise: numeric("montant_indemnise", { precision: 10, scale: 2 }),
  franchise: numeric("franchise", { precision: 10, scale: 2 }),
  notes: text("notes"),
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id)
});
