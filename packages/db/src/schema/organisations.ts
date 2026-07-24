import { pgEnum, pgTable, text } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";

export const organisationTypeEnum = pgEnum("organisation_type", ["particulier", "syndic"]);
export const organisationStatutEnum = pgEnum("organisation_statut", ["actif", "archive"]);

export const organisations = pgTable("organisations", {
  ...auditColumns,
  type: organisationTypeEnum("type").notNull(),
  nom: text("nom").notNull(),
  emailContact: text("email_contact"),
  statut: organisationStatutEnum("statut").notNull().default("actif")
});
