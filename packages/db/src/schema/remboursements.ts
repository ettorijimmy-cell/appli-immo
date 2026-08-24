import { date, decimal, integer, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
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

// Catégories de retenue légitime sur dépôt de garantie (loi n° 89-462,
// art. 22 : toute retenue doit être "dûment justifiée", mais la loi
// n'impose aucune nomenclature — catégories issues de la pratique/
// jurisprudence, docs/backlog.md). "ménage non fait" volontairement fondu
// dans reparations_locatives_non_effectuees : même fondement juridique
// (entretien courant à la charge du locataire), pas une dégradation.
export const remboursementMotifRetenueEnum = pgEnum("remboursement_motif_retenue", [
  "degradation_locative",
  "reparations_locatives_non_effectuees",
  "charges_impayees",
  "loyers_impayes",
  "autre"
]);

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
  mode: paiementModeEnum("mode").notNull(),
  // Les 5 colonnes suivantes ne sont renseignées que pour une retenue réelle
  // sur dépôt de garantie (type=depot_garantie ET montantRembourse <
  // montantOrigine) — toujours ensemble ou toujours null, jamais l'un sans
  // l'autre (RemboursementsService.create()). Colonnes dédiées plutôt qu'une
  // 7e cible sur le lien polymorphe `documents` (relation 1:1 stricte,
  // aucun cycle de vie expiration/versioning à gérer ici — docs/backlog.md).
  motifRetenue: remboursementMotifRetenueEnum("motif_retenue"),
  // Clé/chemin du blob chiffré sur disque (repli local) ou objet Object
  // Storage (Scaleway prod), même mécanique que documents.chemin_stockage
  // (DocumentStorageService, chiffrer: true) — jamais exposé au frontend.
  pieceJustificativeChemin: text("piece_justificative_chemin"),
  pieceJustificativeNomFichier: text("piece_justificative_nom_fichier"),
  pieceJustificativeMimeType: text("piece_justificative_mime_type"),
  pieceJustificativeTailleOctets: integer("piece_justificative_taille_octets")
});
