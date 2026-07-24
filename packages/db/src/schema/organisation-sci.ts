import { date, pgEnum, pgTable, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { organisations } from "./organisations";

export const organisationSciRoleEnum = pgEnum("organisation_sci_role", [
  "proprietaire",
  "mandataire"
]);

export const organisationSci = pgTable("organisation_sci", {
  ...auditColumns,
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id),
  // Pas de `.references()` : la table `scis` n'existe pas encore, elle
  // arrive avec le Module 1. La contrainte de clé étrangère sera ajoutée
  // dans la migration du Module 1, une fois `scis` créée.
  sciId: uuid("sci_id").notNull(),
  role: organisationSciRoleEnum("role").notNull(),
  dateDebut: date("date_debut").notNull(),
  dateFin: date("date_fin")
});
