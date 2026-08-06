import { IsDateString, IsOptional, IsString } from "class-validator";

export class UpdateEtatDesLieuxDto {
  @IsOptional()
  @IsDateString()
  dateEntree?: string;

  @IsOptional()
  @IsDateString()
  dateSortie?: string;

  // Décret n° 2016-382, art. 2, 2° a — connu uniquement à la sortie,
  // jamais à l'entrée. Texte libre, décision assumée.
  @IsOptional()
  @IsString()
  nouvelleAdresseLocataire?: string;
}
