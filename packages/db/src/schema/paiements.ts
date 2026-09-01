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
  dateEcheance: date("date_echeance").notNull(),
  // Décomposition FIGÉE au moment de la génération de l'échéance (Module
  // Tâches, Étape 4 — quittance mensuelle, 2026-08-31), jamais recalculée
  // rétroactivement même si baux.loyerMensuel/provisionsCharges sont
  // révisés ensuite — décision produit explicite (docs/backlog.md),
  // volontairement différente de calculerProvisionsRecuesEcheance/
  // calculerLoyerNetRecuEcheance (packages/core), qui restent des
  // ESTIMATIONS basées sur les valeurs actuelles du bail, utilisées
  // uniquement par l'agrégation du tableau de bord (Module 7), sans
  // changement sur leur usage. Nullables : compatibilité avec les échéances
  // déjà existantes avant cette colonne, jamais rétro-remplies. Renseignées
  // systématiquement pour toute nouvelle échéance par
  // AlertesJobService.genererEcheancesRecurrentes.
  loyerHorsCharges: decimal("loyer_hors_charges", { precision: 10, scale: 2 }),
  charges: decimal("charges", { precision: 10, scale: 2 })
});
