import { Type } from "class-transformer";
import { IsDecimal, IsOptional, IsString, ValidateNested } from "class-validator";

class CompteurElectriciteDto {
  @IsOptional()
  @IsString()
  numeroCompteurEntree?: string;

  @IsOptional()
  @IsString()
  numeroCompteurSortie?: string;

  @IsOptional()
  @IsDecimal()
  releveHpEntree?: string;

  @IsOptional()
  @IsDecimal()
  releveHpSortie?: string;

  @IsOptional()
  @IsDecimal()
  releveHcEntree?: string;

  @IsOptional()
  @IsDecimal()
  releveHcSortie?: string;

  // Dernier relevé de l'ancien occupant, référence pour la continuité de
  // facturation — présent aux deux moments dans le modèle réel, reproduit
  // tel quel (Option B).
  @IsOptional()
  @IsDecimal()
  ancienOccupantEntree?: string;

  @IsOptional()
  @IsDecimal()
  ancienOccupantSortie?: string;
}

class CompteurGazDto {
  @IsOptional()
  @IsString()
  numeroCompteurEntree?: string;

  @IsOptional()
  @IsString()
  numeroCompteurSortie?: string;

  @IsOptional()
  @IsDecimal()
  releveEntree?: string;

  @IsOptional()
  @IsDecimal()
  releveSortie?: string;
}

class CompteurEauDto {
  // Pas de numéro de compteur pour l'eau — absent du modèle réel.
  @IsOptional()
  @IsDecimal()
  releveFroideEntree?: string;

  @IsOptional()
  @IsDecimal()
  releveFroideSortie?: string;

  @IsOptional()
  @IsDecimal()
  releveChaudeEntree?: string;

  @IsOptional()
  @IsDecimal()
  releveChaudeSortie?: string;
}

// Colonne Internet retirée du modèle réel par le propriétaire (aucun
// champ structuré derrière) — pas de section ici.
export class SubmitCompteursDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => CompteurElectriciteDto)
  electricite?: CompteurElectriciteDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CompteurGazDto)
  gaz?: CompteurGazDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CompteurEauDto)
  eau?: CompteurEauDto;
}
