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

  // Facultatifs ici (contrairement à CreateSciDto) : une SCI créée avant
  // que ces champs deviennent obligatoires à la création doit rester
  // modifiable normalement, sans être forcée à tout ressaisir d'un coup
  // (docs/data-dictionary.md).
  @IsOptional()
  @IsString()
  @MinLength(1)
  adresse?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  codePostal?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  ville?: string;

  @IsOptional()
  @IsString()
  telephone?: string;

  // Pas de valeur par défaut, y compris ici : un envoi explicite de
  // `false` doit rester possible (docs/data-dictionary.md).
  @IsOptional()
  @IsBoolean()
  estFamiliale?: boolean;
}
