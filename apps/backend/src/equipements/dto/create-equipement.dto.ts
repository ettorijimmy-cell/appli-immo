import { IsDateString, IsIn, IsInt, IsOptional, IsUUID, Min } from "class-validator";

const EQUIPEMENT_TYPES = ["chaudiere", "ballon_eau_chaude", "autre"] as const;

export class CreateEquipementDto {
  @IsUUID()
  appartementId!: string;

  @IsIn(EQUIPEMENT_TYPES)
  type!: (typeof EQUIPEMENT_TYPES)[number];

  @IsOptional()
  @IsDateString()
  dateDernierEntretien?: string;

  // Pas de valeur par défaut par type : tant qu'absent, l'alerte
  // entretien_equipement (Module 6) ne se déclenche jamais pour cet
  // équipement (docs/data-dictionary.md).
  @IsOptional()
  @IsInt()
  @Min(1)
  intervalleEntretienMois?: number;
}
