import { Transform } from "class-transformer";
import { IsDateString, IsIn, IsNumberString, IsOptional } from "class-validator";
import { normaliserMontant } from "core";

const PAIEMENT_TYPES = ["loyer", "charges", "depot_garantie"] as const;

// Volontairement AUCUN champ statut/montant_paye/mode/date_paiement/
// reference_rapprochement ici : ces champs ne se modifient que via
// enregistrerPaiement() ou annulerEnregistrement() (voir
// PaiementsController), qui recalculent le statut à chaque écriture — même
// principe de défense en profondeur que UpdateBailDto (Module 3).
export class UpdatePaiementDto {
  @IsOptional()
  @IsIn(PAIEMENT_TYPES)
  type?: (typeof PAIEMENT_TYPES)[number];

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  montant?: string;

  @IsOptional()
  @IsDateString()
  dateEcheance?: string;
}
