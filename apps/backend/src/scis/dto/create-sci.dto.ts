import { IsIn, IsOptional, IsString, MinLength } from "class-validator";

export class CreateSciDto {
  @IsString()
  @MinLength(1)
  nom!: string;

  @IsIn(["IS", "IR"])
  regimeFiscal!: "IS" | "IR";

  @IsOptional()
  @IsString()
  formeJuridique?: string;

  @IsOptional()
  @IsString()
  siret?: string;

  // Siège social — connu dès la création d'une SCI, contrairement à
  // est_familiale/telephone (choix ou coordonnée à renseigner
  // progressivement, restés facultatifs). Obligatoire uniquement à la
  // création : le schéma reste nullable, les SCI déjà créées avant ce
  // durcissement ne sont jamais forcées rétroactivement
  // (docs/data-dictionary.md).
  @IsString()
  @MinLength(1)
  adresse!: string;

  @IsString()
  @MinLength(1)
  codePostal!: string;

  @IsString()
  @MinLength(1)
  ville!: string;
}
