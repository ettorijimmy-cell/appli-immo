import { IsDateString, IsIn, IsOptional, IsUUID } from "class-validator";

const EQUIPEMENT_TYPES = ["chaudiere", "ballon_eau_chaude", "autre"] as const;

export class CreateEquipementDto {
  @IsUUID()
  appartementId!: string;

  @IsIn(EQUIPEMENT_TYPES)
  type!: (typeof EQUIPEMENT_TYPES)[number];

  @IsOptional()
  @IsDateString()
  dateDernierEntretien?: string;
}
