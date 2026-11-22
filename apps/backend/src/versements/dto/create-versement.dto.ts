import { IsDateString, IsIn, IsOptional, IsString, IsUUID } from "class-validator";
import { MontantSaisi } from "../../common/montant-saisi.decorator";

const PAIEMENT_MODES = ["virement", "cheque", "especes", "caf"] as const;

export class CreateVersementDto {
  @IsUUID()
  paiementId!: string;

  // Strictement positif (petites suites, décision 3) ; normalise
  // virgule/point/espaces avant la validation (MontantSaisi).
  @MontantSaisi("montant du versement", "strictement_positif")
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
