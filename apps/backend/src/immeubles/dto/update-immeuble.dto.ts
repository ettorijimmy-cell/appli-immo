import { IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from "class-validator";

const TYPES_HABITAT = ["collectif", "individuel"] as const;
const REGIMES_JURIDIQUES = ["mono_propriete", "copropriete"] as const;

export class UpdateImmeubleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  nom?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  adresse?: string;

  @IsOptional()
  @IsString()
  codePostal?: string;

  @IsOptional()
  @IsString()
  ville?: string;

  // Mentions du contrat-type (décret n° 2015-587) — jamais exposées
  // jusqu'ici malgré la colonne déjà en base depuis le Module "Édition
  // d'un bail" (docs/backlog.md) : sans ce champ, le contrôle de
  // complétude de la génération du bail bloque systématiquement.
  @IsOptional()
  @IsInt()
  @Min(1800)
  @Max(2100)
  anneeConstruction?: number;

  @IsOptional()
  @IsIn(TYPES_HABITAT)
  typeHabitat?: (typeof TYPES_HABITAT)[number];

  @IsOptional()
  @IsIn(REGIMES_JURIDIQUES)
  regimeJuridique?: (typeof REGIMES_JURIDIQUES)[number];
}
