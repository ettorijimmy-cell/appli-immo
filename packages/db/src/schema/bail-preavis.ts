import { sql } from "drizzle-orm";
import { check, date, index, integer, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { baux } from "./baux";
import { auditColumns } from "./columns.helpers";
import { organisations } from "./organisations";
import { utilisateurs } from "./utilisateurs";

// Auteur du congé (loi n° 89-462, art. 15 pour le vide, art. 25-8 pour le
// meublé).
export const preavisAuteurEnum = pgEnum("preavis_auteur", ["locataire", "bailleur"]);

// Mode de remise du congé (art. 15 : lettre recommandée avec avis de
// réception, signification par commissaire de justice, remise en main
// propre contre récépissé ou émargement). Facultatif : trace seulement.
export const preavisModeRemiseEnum = pgEnum("preavis_mode_remise", ["lrar", "commissaire_justice", "main_propre"]);

// Motif de préavis réduit à un mois (bail vide, congé du locataire,
// art. 15 I, 1° à 5°) — mêmes valeurs que MOTIFS_PREAVIS_REDUIT
// (packages/core/src/baux/preavis.ts).
export const preavisMotifReduitEnum = pgEnum("preavis_motif_reduit", [
  "zone_tendue",
  "premier_emploi",
  "mutation",
  "perte_emploi",
  "nouvel_emploi_apres_perte",
  "sante",
  "violences",
  "rsa_aah",
  "logement_social"
]);

// Pourquoi une déclaration n'est plus active : corrigée (une nouvelle ligne
// la remplace), annulée (le bail revient « actif »), ou close par la
// résiliation du bail.
export const preavisMotifFinEnum = pgEnum("preavis_motif_fin", ["corrige", "annule", "resilie"]);

// Préavis d'un bail (résiliation, conception 2 « vrai préavis », décisions
// de Jimmy du 2026-11-15, migration 0079). Une ligne active par bail en
// préavis ; une correction archive la ligne active (motif_fin « corrige »)
// et en insère une nouvelle, même modèle que garant_remise_bail et
// etat_des_lieux_entree_papier — le congé est un acte juridique daté, son
// historique sert de preuve.
//
// Lien avec baux : tant qu'une ligne est active, baux.statut vaut « preavis »
// et baux.date_fin vaut date_fin (la date de fin confirmée) ; date_fin_bail_avant
// garde l'ancienne valeur de baux.date_fin pour l'annulation. Cohérence
// tenue par le service (une CHECK ne lit pas une autre table).
//
// Garanties portées par la base, posées à la main dans la migration
// (drizzle-kit ne gère pas les triggers) :
// - aucune suppression ni vidage de la table ;
// - une ligne n'est jamais modifiée, sauf pour être archivée une fois
//   (archived_at et motif_fin posés ensemble).
// Hors publication et hors PowerSync, lue en REST uniquement. Voir
// docs/data-dictionary.md.
export const bailPreavis = pgTable(
  "bail_preavis",
  {
    ...auditColumns,
    bailId: uuid("bail_id")
      .notNull()
      .references(() => baux.id),
    // Dénormalisé (scoping sans jointure), comme garant_remise_bail.
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    auteur: preavisAuteurEnum("auteur").notNull(),
    // Point de départ du préavis (réception de la LRAR, signification ou
    // remise en main propre).
    dateReception: date("date_reception").notNull(),
    modeRemise: preavisModeRemiseEnum("mode_remise"),
    dureeMois: integer("duree_mois").notNull(),
    motifReduit: preavisMotifReduitEnum("motif_reduit"),
    // Calculée par Briky (dateFinPreavisProposee), gardée pour trace.
    dateFinProposee: date("date_fin_proposee").notNull(),
    // Confirmée ou corrigée par Jimmy ; recopiée dans baux.date_fin.
    dateFin: date("date_fin").notNull(),
    // baux.date_fin avant la déclaration, rétablie à l'annulation.
    dateFinBailAvant: date("date_fin_bail_avant"),
    motifFin: preavisMotifFinEnum("motif_fin"),
    declareeLe: timestamp("declaree_le", { withTimezone: true }).notNull(),
    declareePar: uuid("declaree_par")
      .notNull()
      .references(() => utilisateurs.id)
  },
  (table) => [
    // Un seul préavis actif par bail ; les lignes archivées restent en
    // historique.
    uniqueIndex("bail_preavis_actif_unique")
      .on(table.bailId)
      .where(sql`${table.archivedAt} IS NULL`),
    index("bail_preavis_historique_idx").on(table.bailId),
    check("bail_preavis_duree_mois", sql`${table.dureeMois} BETWEEN 1 AND 6`),
    check("bail_preavis_date_fin_apres_reception", sql`${table.dateFin} >= ${table.dateReception}`),
    check(
      "bail_preavis_motif_reduit_locataire",
      sql`${table.auteur} <> 'bailleur' OR ${table.motifReduit} IS NULL`
    ),
    check(
      "bail_preavis_archivage_coherent",
      sql`(${table.archivedAt} IS NULL) = (${table.motifFin} IS NULL)`
    )
  ]
);
