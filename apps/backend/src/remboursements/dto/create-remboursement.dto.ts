import { IsDateString, IsIn, IsOptional, IsString, IsUUID } from "class-validator";
import { MontantSaisi } from "../../common/montant-saisi.decorator";

const REMBOURSEMENT_TYPES = ["trop_percu", "depot_garantie"] as const;
const PAIEMENT_MODES = ["virement", "cheque", "especes", "caf"] as const;
const REMBOURSEMENT_MOTIFS_RETENUE = [
  "degradation_locative",
  "reparations_locatives_non_effectuees",
  "charges_impayees",
  "loyers_impayes",
  "autre"
] as const;
export type RemboursementMotifRetenue = (typeof REMBOURSEMENT_MOTIFS_RETENUE)[number];

export class CreateRemboursementDto {
  @IsUUID()
  bailId!: string;

  // Lien optionnel vers l'échéance/le dépôt d'origine (docs/data-dictionary.md,
  // section "versements & remboursements") — quand il est fourni, sert de
  // base à la validation "somme des remboursements <= montant réellement
  // reçu" (RemboursementsService.create()).
  @IsOptional()
  @IsUUID()
  paiementId?: string;

  @IsIn(REMBOURSEMENT_TYPES)
  type!: (typeof REMBOURSEMENT_TYPES)[number];

  // Bornes (petites suites, décision 3) : ce qui a été perçu est
  // strictement positif ; ce qui est rendu peut valoir 0 (retenue totale
  // sur le dépôt de garantie, avec motif et justificatif). Le 0 € d'un
  // trop-perçu dépend du champ `type` : refusé dans
  // RemboursementsService.create(), après le contrôle d'appartenance.
  @MontantSaisi("montant reçu à l'origine", "strictement_positif")
  montantOrigine!: string;

  @MontantSaisi("montant remboursé", "positif_ou_nul")
  montantRembourse!: string;

  @IsOptional()
  @IsString()
  commentaire?: string;

  @IsDateString()
  dateRemboursement!: string;

  @IsIn(PAIEMENT_MODES)
  mode!: (typeof PAIEMENT_MODES)[number];

  // Requis ensemble (avec la pièce jointe multipart, champ "pieceJustificative")
  // uniquement si type=depot_garantie ET montantRembourse < montantOrigine
  // (retenue réelle) — sinon toujours absent. Validé dans
  // RemboursementsService.create(), pas de contrainte DB possible sur cette
  // règle conditionnelle (même principe que documents.etatDesLieuxPieceType).
  @IsOptional()
  @IsIn(REMBOURSEMENT_MOTIFS_RETENUE)
  motifRetenue?: RemboursementMotifRetenue;
}
