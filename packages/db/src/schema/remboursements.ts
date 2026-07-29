import { date, decimal, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { baux } from "./baux";
import { paiementModeEnum, paiements } from "./paiements";

// Générique plutôt que spécifique à la caution (docs/data-dictionary.md,
// section "versements & remboursements") : couvre le trop-perçu à la
// résiliation et le remboursement du dépôt de garantie via ce type, sans
// dupliquer deux tables quasi identiques. Jamais un `paiements.type`
// négatif — un remboursement inverse le sens du flux (propriétaire ->
// locataire), une table à part rend cette direction structurellement
// impossible à confondre avec un encaissement.
export const remboursementTypeEnum = pgEnum("remboursement_type", ["trop_percu", "depot_garantie"]);

export const remboursements = pgTable("remboursements", {
  ...auditColumns,
  bailId: uuid("bail_id")
    .notNull()
    .references(() => baux.id),
  // Lien optionnel vers l'échéance/le dépôt d'origine (le paiement
  // type=depot_garantie pour un remboursement de caution, l'échéance
  // type=loyer en trop-perçu pour l'autre cas) — jamais requis, l'ancre
  // stable reste bailId.
  paiementId: uuid("paiement_id").references(() => paiements.id),
  type: remboursementTypeEnum("type").notNull(),
  // Ce qui avait été perçu à l'origine — jamais modifié après coup, sert de
  // référence pour juger l'écart avec montantRembourse.
  montantOrigine: decimal("montant_origine", { precision: 10, scale: 2 }).notNull(),
  // Ce qui est effectivement rendu — peut différer de montantOrigine (ex.
  // retenue sur dégradations constatées à l'état des lieux de sortie).
  montantRembourse: decimal("montant_rembourse", { precision: 10, scale: 2 }).notNull(),
  commentaire: text("commentaire"),
  dateRemboursement: date("date_remboursement").notNull(),
  mode: paiementModeEnum("mode").notNull()
});
