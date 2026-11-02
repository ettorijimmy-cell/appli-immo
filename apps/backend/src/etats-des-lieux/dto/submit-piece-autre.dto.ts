import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, Min, MinLength, ValidateNested } from "class-validator";
import { EtatElementDto } from "./etat-element.dto";
import { PrisesElectriquesDto } from "./prises-electriques.dto";
import { LONGUEUR_MAX_OBSERVATION_SORTIE } from "core";
import { TexteObservation } from "./texte-observation.decorator";

export class SubmitPieceAutreDto {
  // 1 à 2 (2 emplacements libres dans le modèle réel).
  @IsInt()
  @Min(1)
  @Max(2)
  numero!: number;

  // Libellé de la pièce, saisi librement (ex. "Bureau", "Buanderie", ou
  // "Chambre 4" en cas de dépassement du maximum de 3 chambres).
  @IsString()
  @MinLength(1)
  libelle!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => EtatElementDto)
  mur?: EtatElementDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => EtatElementDto)
  sol?: EtatElementDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => EtatElementDto)
  vitrageVolets?: EtatElementDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => EtatElementDto)
  plafond?: EtatElementDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => EtatElementDto)
  eclairage?: EtatElementDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PrisesElectriquesDto)
  prises?: PrisesElectriquesDto;

  // Évolutions de la pièce constatées à la sortie (décret n° 2016-382, art. 2, 2° c).
  @TexteObservation(LONGUEUR_MAX_OBSERVATION_SORTIE)
  observationsSortie?: string | null;
}
