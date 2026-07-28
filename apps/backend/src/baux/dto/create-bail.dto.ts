import { Transform } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsNumberString, IsOptional, IsUUID, Max, Min } from "class-validator";
import { normaliserMontant } from "core";

const BAIL_TYPES = ["vide", "meuble"] as const;

export class CreateBailDto {
  @IsUUID()
  appartementId!: string;

  @IsIn(BAIL_TYPES)
  typeBail!: (typeof BAIL_TYPES)[number];

  @IsDateString()
  dateDebut!: string;

  @IsOptional()
  @IsDateString()
  dateFin?: string;

  // Si absent, pré-rempli depuis appartements.loyer_reference
  // (packages/core, preremplirLoyerBail) — voir BauxService.create.
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

  // Requis pour activer() (voir docs/data-dictionary.md), mais pas à la
  // création — renseignable progressivement comme loyerMensuel/depotGarantie.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  jourEcheance?: number;
}
