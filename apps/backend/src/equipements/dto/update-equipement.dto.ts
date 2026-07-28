import { IsDateString, IsIn, IsInt, IsOptional, Min } from "class-validator";

const EQUIPEMENT_TYPES = ["chaudiere", "ballon_eau_chaude", "autre"] as const;

export class UpdateEquipementDto {
  @IsOptional()
  @IsIn(EQUIPEMENT_TYPES)
  type?: (typeof EQUIPEMENT_TYPES)[number];

  @IsOptional()
  @IsDateString()
  dateDernierEntretien?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  intervalleEntretienMois?: number;
}
