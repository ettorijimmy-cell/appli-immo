import { sql } from "drizzle-orm";
import { date, index, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { garants } from "./garants";
import { organisations } from "./organisations";
import { utilisateurs } from "./utilisateurs";

// Mode de remise d'un exemplaire du bail à la caution.
export const garantRemiseBailModeEnum = pgEnum("garant_remise_bail_mode", [
  "main_propre",
  "lettre_recommandee",
  "courrier_simple",
  "email"
]);

// Remise d'un exemplaire du bail à la caution (2026-11-08, chantier
// garants, migration 0078) : déclaration datée par le bailleur, qui
// sert de trace (loi n° 89-462, art. 22-1 : un exemplaire du bail est remis
// à la caution). Même modèle que etat_des_lieux_entree_papier :
// une correction écrit une nouvelle ligne et archive la précédente.
//
// Garanties portées par la base, posées à la main dans la migration
// (drizzle-kit ne gère pas les triggers) :
// - aucune suppression ni vidage de la table ;
// - une ligne n'est jamais modifiée, sauf pour être archivée une fois.
// Hors publication et hors PowerSync, lue en REST uniquement. Voir
// docs/data-dictionary.md.
export const garantRemiseBail = pgTable(
  "garant_remise_bail",
  {
    ...auditColumns,
    garantId: uuid("garant_id")
      .notNull()
      .references(() => garants.id),
    // Dénormalisé depuis garants.organisation_id, comme garants lui-même
    // (scoping sans jointure).
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    dateRemise: date("date_remise").notNull(),
    mode: garantRemiseBailModeEnum("mode").notNull(),
    declareeLe: timestamp("declaree_le", { withTimezone: true }).notNull(),
    declareePar: uuid("declaree_par")
      .notNull()
      .references(() => utilisateurs.id)
  },
  (table) => [
    // Une seule déclaration active par garant ; les corrections archivées
    // restent en historique.
    uniqueIndex("garant_remise_bail_active_unique")
      .on(table.garantId)
      .where(sql`${table.archivedAt} IS NULL`),
    index("garant_remise_bail_historique_idx").on(table.garantId)
  ]
);
