import { Transform } from "class-transformer";
import { IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID } from "class-validator";
import { normaliserMontant } from "core";

const PAIEMENT_MODES = ["virement", "cheque", "especes", "caf"] as const;

export class CreateVersementDto {
  @IsUUID()
  paiementId!: string;

  // Normalise virgule/point/espaces AVANT la validation (voir
  // normaliserMontant, packages/core) — même principe que
  // CreatePaiementDto.
  @Transform(({ value }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  montant!: string;

  @IsIn(PAIEMENT_MODES)
  mode!: (typeof PAIEMENT_MODES)[number];

  @IsDateString()
  dateVersement!: string;

  // Renseigné uniquement lors d'une confirmation de rapprochement CSV : le
  // libellé de la ligne de relevé retenue POUR CE versement.
  @IsOptional()
  @IsString()
  referenceRapprochement?: string;
}
