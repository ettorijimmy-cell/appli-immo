import { Transform } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsNumberString, IsOptional, IsString, Max, Min } from "class-validator";
import { normaliserMontant } from "core";

const BAIL_TYPES = ["vide", "meuble"] as const;

// Volontairement AUCUN champ `statut` ici : les transitions de statut d'un
// bail passent exclusivement par les endpoints dédiés (activer / résilier /
// archiver, voir BauxController), qui déclenchent aussi la transition
// automatique du statut de l'appartement. Un update() générique ne doit
// jamais pouvoir contourner cette règle par inadvertance.
export class UpdateBailDto {
  @IsOptional()
  @IsIn(BAIL_TYPES)
  typeBail?: (typeof BAIL_TYPES)[number];

  @IsOptional()
  @IsDateString()
  dateDebut?: string;

  @IsOptional()
  @IsDateString()
  dateFin?: string;

  @IsOptional()
  @IsDateString()
  dateSignature?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  loyerMensuel?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  depotGarantie?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  provisionsCharges?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  jourEcheance?: number;

  @IsOptional()
  @IsString()
  travauxRealises?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  honorairesBailleur?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  honorairesLocataire?: string;
}
