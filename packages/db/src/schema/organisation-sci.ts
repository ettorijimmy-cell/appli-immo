import { date, pgEnum, pgTable, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { organisations } from "./organisations";
import { scis } from "./scis";

export const organisationSciRoleEnum = pgEnum("organisation_sci_role", [
  "proprietaire",
  "mandataire"
]);

export const organisationSci = pgTable("organisation_sci", {
  ...auditColumns,
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id),
  sciId: uuid("sci_id")
    .notNull()
    .references(() => scis.id),
  role: organisationSciRoleEnum("role").notNull(),
  dateDebut: date("date_debut").notNull(),
  dateFin: date("date_fin")
});
