import { pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { baux } from "./baux";
import { auditColumns } from "./columns.helpers";

export const garantTypeGarantieEnum = pgEnum("garant_type_garantie", [
  "personne_physique",
  "garantie_visale",
  "autre"
]);

export const garants = pgTable("garants", {
  ...auditColumns,
  bailId: uuid("bail_id")
    .notNull()
    .references(() => baux.id),
  nom: text("nom").notNull(),
  prenom: text("prenom").notNull(),
  email: text("email"),
  telephone: text("telephone"),
  typeGarantie: garantTypeGarantieEnum("type_garantie").notNull()
});
