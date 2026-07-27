import { date, pgEnum, pgTable, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { appartements } from "./appartements";

export const equipementTypeEnum = pgEnum("equipement_type", [
  "chaudiere",
  "ballon_eau_chaude",
  "autre"
]);

export const equipements = pgTable("equipements", {
  ...auditColumns,
  appartementId: uuid("appartement_id")
    .notNull()
    .references(() => appartements.id),
  type: equipementTypeEnum("type").notNull(),
  dateDernierEntretien: date("date_dernier_entretien")
});
