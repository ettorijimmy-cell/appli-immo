import { Transform } from "class-transformer";
import { IsDateString, IsIn, IsNumberString, IsOptional, IsString } from "class-validator";
import { normaliserMontant } from "core";

const PAIEMENT_MODES = ["virement", "cheque", "especes", "caf"] as const;

export class EnregistrerPaiementDto {
  // Normalise virgule/point/espaces AVANT la validation (voir
  // normaliserMontant, packages/core) — un relevé CSV rapproché fournit un
  // montant à virgule décimale (format bancaire français), qui échouerait
  // sinon @IsNumberString (voir docs/error-log.md).
  @Transform(({ value }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  montantPaye!: string;

  @IsIn(PAIEMENT_MODES)
  mode!: (typeof PAIEMENT_MODES)[number];

  @IsDateString()
  datePaiement!: string;

  // Renseigné uniquement lors d'une confirmation de rapprochement CSV : le
  // libellé de la ligne de relevé retenue (docs/data-dictionary.md).
  @IsOptional()
  @IsString()
  referenceRapprochement?: string;
}
