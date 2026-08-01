import { IsIn, IsOptional, IsString, IsUUID, MinLength } from "class-validator";

const TYPES_HABITAT = ["collectif", "individuel"] as const;
const REGIMES_JURIDIQUES = ["mono_propriete", "copropriete"] as const;

export class CreateImmeubleDto {
  @IsUUID()
  sciId!: string;

  @IsString()
  @MinLength(1)
  nom!: string;

  @IsString()
  @MinLength(1)
  adresse!: string;

  @IsOptional()
  @IsString()
  codePostal?: string;

  @IsOptional()
  @IsString()
  ville?: string;

  // Caractéristiques du bâtiment — connues dès la création de l'immeuble,
  // contrairement à annee_construction (souvent une recherche, resté
  // facultatif). Obligatoire uniquement à la création : le schéma reste
  // nullable, les immeubles déjà créés avant ce durcissement ne sont
  // jamais forcés rétroactivement (docs/data-dictionary.md).
  @IsIn(TYPES_HABITAT)
  typeHabitat!: (typeof TYPES_HABITAT)[number];

  @IsIn(REGIMES_JURIDIQUES)
  regimeJuridique!: (typeof REGIMES_JURIDIQUES)[number];
}
