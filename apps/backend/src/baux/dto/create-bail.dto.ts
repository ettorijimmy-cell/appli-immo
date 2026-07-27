import { IsDateString, IsIn, IsNumberString, IsOptional, IsUUID } from "class-validator";

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
  @IsNumberString()
  loyerMensuel?: string;

  @IsOptional()
  @IsNumberString()
  depotGarantie?: string;
}
