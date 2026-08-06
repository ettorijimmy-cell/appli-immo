import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min, ValidateNested } from "class-validator";
import { EtatElementDto } from "./etat-element.dto";
import { PrisesElectriquesDto } from "./prises-electriques.dto";

export class SubmitPieceWcDto {
  // 1 à 2 (jusqu'à 2 WC dans le modèle réel).
  @IsInt()
  @Min(1)
  @Max(2)
  numero!: number;

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
  lavabo?: EtatElementDto;

  // La cuvette elle-même, élément distinct du lavabo — présent tel quel
  // dans le modèle réel.
  @IsOptional()
  @ValidateNested()
  @Type(() => EtatElementDto)
  wc?: EtatElementDto;
}
