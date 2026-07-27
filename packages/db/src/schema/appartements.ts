import { decimal, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { immeubles } from "./immeubles";

export const appartementTypeEnum = pgEnum("appartement_type", ["T1", "T2", "T3", "T4", "T5+"]);
export const appartementStatutEnum = pgEnum("appartement_statut", [
  "vacant",
  "loue",
  "travaux",
  "archive"
]);

export const appartements = pgTable("appartements", {
  ...auditColumns,
  immeubleId: uuid("immeuble_id")
    .notNull()
    .references(() => immeubles.id),
  numero: text("numero").notNull(),
  type: appartementTypeEnum("type").notNull(),
  surface: decimal("surface", { precision: 6, scale: 2 }),
  loyerReference: decimal("loyer_reference", { precision: 10, scale: 2 }),
  // 'vacant' par défaut : un appartement nouvellement créé n'a pas encore
  // de bail actif (règle de transition automatique vacant -> loue au
  // Module 3).
  statut: appartementStatutEnum("statut").notNull().default("vacant")
});
