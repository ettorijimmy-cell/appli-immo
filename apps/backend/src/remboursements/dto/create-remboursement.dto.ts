import { Transform } from "class-transformer";
import { IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID } from "class-validator";
import { normaliserMontant } from "core";

const REMBOURSEMENT_TYPES = ["trop_percu", "depot_garantie"] as const;
const PAIEMENT_MODES = ["virement", "cheque", "especes", "caf"] as const;

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

  @Transform(({ value }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  montantOrigine!: string;

  @Transform(({ value }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  montantRembourse!: string;

  @IsOptional()
  @IsString()
  commentaire?: string;

  @IsDateString()
  dateRemboursement!: string;

  @IsIn(PAIEMENT_MODES)
  mode!: (typeof PAIEMENT_MODES)[number];
}
