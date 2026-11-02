import { Type } from "class-transformer";
import { IsOptional, ValidateNested } from "class-validator";
import { EtatElementDto } from "./etat-element.dto";
import { PrisesElectriquesDto } from "./prises-electriques.dto";
import { LONGUEUR_MAX_OBSERVATION_SORTIE } from "core";
import { TexteObservation } from "./texte-observation.decorator";

export class SubmitPieceEntreeDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => EtatElementDto)
  porte?: EtatElementDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => EtatElementDto)
  sonnette?: EtatElementDto;

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
