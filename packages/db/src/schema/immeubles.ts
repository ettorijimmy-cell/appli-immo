import { pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { scis } from "./scis";

export const immeubleStatutEnum = pgEnum("immeuble_statut", ["actif", "archive"]);

export const immeubles = pgTable("immeubles", {
  ...auditColumns,
  // FK directe vers scis, pas de table de liaison — contrairement à
  // organisation_sci, un immeuble appartient à exactement une SCI.
  sciId: uuid("sci_id")
    .notNull()
    .references(() => scis.id),
  nom: text("nom").notNull(),
  adresse: text("adresse").notNull(),
  codePostal: text("code_postal"),
  ville: text("ville"),
  statut: immeubleStatutEnum("statut").notNull().default("actif")
});
