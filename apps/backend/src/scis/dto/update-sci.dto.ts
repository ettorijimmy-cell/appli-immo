import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from "class-validator";

export class UpdateSciDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  nom?: string;

  @IsOptional()
  @IsIn(["IS", "IR"])
  regimeFiscal?: "IS" | "IR";

  @IsOptional()
  @IsString()
  formeJuridique?: string;

  @IsOptional()
  @IsString()
  siret?: string;

  @IsOptional()
  @IsString()
  telephone?: string;

  // Pas de valeur par défaut, y compris ici : un envoi explicite de
  // `false` doit rester possible (docs/data-dictionary.md).
  @IsOptional()
  @IsBoolean()
  estFamiliale?: boolean;
}
