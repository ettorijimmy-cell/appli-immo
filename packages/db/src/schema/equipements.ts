import { date, integer, pgEnum, pgTable, uuid } from "drizzle-orm/pg-core";
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
  dateDernierEntretien: date("date_dernier_entretien"),
  // Périodicité attendue en mois, saisie librement (pas de valeur par
  // défaut par type, voir docs/data-dictionary.md) — l'alerte
  // entretien_equipement (Module 6) ne se déclenche jamais tant que ce
  // champ ou date_dernier_entretien est absent.
  intervalleEntretienMois: integer("intervalle_entretien_mois")
});
