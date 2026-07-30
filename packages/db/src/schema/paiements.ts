import { decimal, pgEnum, pgTable, uuid, date } from "drizzle-orm/pg-core";
import { baux } from "./baux";
import { auditColumns } from "./columns.helpers";

export const paiementTypeEnum = pgEnum("paiement_type", ["loyer", "charges", "depot_garantie"]);
// Toujours utilisé par versements/remboursements (voir versements.ts,
// remboursements.ts) — jamais par paiements lui-même depuis le retrait de
// montant_paye/mode/date_paiement/reference_rapprochement (Phase 3 du
// chantier "versements & remboursements", docs/data-dictionary.md).
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
  statut: paiementStatutEnum("statut").notNull().default("impaye"),
  montant: decimal("montant", { precision: 10, scale: 2 }).notNull(),
  dateEcheance: date("date_echeance").notNull()
});
