import { Type } from "class-transformer";
import { IsOptional, IsString, ValidateNested } from "class-validator";
import { EtatElementDto } from "./etat-element.dto";
import { PrisesElectriquesDto } from "./prises-electriques.dto";
import { LONGUEUR_MAX_OBSERVATION_SORTIE } from "core";
import { TexteObservation } from "./texte-observation.decorator";

export class SubmitPieceCuisineDto {
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

  @IsOptional()
  @ValidateNested()
  @Type(() => EtatElementDto)
  placards?: EtatElementDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => EtatElementDto)
  evier?: EtatElementDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => EtatElementDto)
  plaquesCuisson?: EtatElementDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => EtatElementDto)
  hotte?: EtatElementDto;

  // Ligne libre du modèle réel ("Électroménager : ……"), sans échelle
  // d'état — distincte de l'inventaire meublé.
  @IsOptional()
  @IsString()
  electromenagerDescription?: string;

  // Évolutions de la pièce constatées à la sortie (décret n° 2016-382, art. 2, 2° c).
  @TexteObservation(LONGUEUR_MAX_OBSERVATION_SORTIE)
  observationsSortie?: string | null;
}
