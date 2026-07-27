import { date, decimal, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { baux } from "./baux";
import { auditColumns } from "./columns.helpers";

export const paiementTypeEnum = pgEnum("paiement_type", ["loyer", "charges", "depot_garantie"]);
export const paiementModeEnum = pgEnum("paiement_mode", ["virement", "cheque", "especes", "caf"]);
// Calculé, jamais saisi directement (packages/core, calculerStatutPaiement)
// — voir docs/data-dictionary.md.
export const paiementStatutEnum = pgEnum("paiement_statut", ["paye", "impaye", "partiel"]);

export const paiements = pgTable("paiements", {
  ...auditColumns,
  bailId: uuid("bail_id")
    .notNull()
    .references(() => baux.id),
  type: paiementTypeEnum("type").notNull(),
  mode: paiementModeEnum("mode"),
  statut: paiementStatutEnum("statut").notNull().default("impaye"),
  montant: decimal("montant", { precision: 10, scale: 2 }).notNull(),
  montantPaye: decimal("montant_paye", { precision: 10, scale: 2 }),
  dateEcheance: date("date_echeance").notNull(),
  datePaiement: date("date_paiement"),
  referenceRapprochement: text("reference_rapprochement")
});
