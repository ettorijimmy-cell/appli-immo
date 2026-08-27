import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength
} from "class-validator";

const TYPES_HABITAT = ["collectif", "individuel"] as const;
const REGIMES_JURIDIQUES = ["mono_propriete", "copropriete"] as const;

// type/proprietaireType/sciId non modifiables ici, même principe que
// CreateImmeubleDto -> UpdateImmeubleDto historiquement (sciId n'y était
// déjà pas modifiable) : changer le mode de détention d'un bien après coup
// est une opération distincte, pas un simple correctif de fiche.
export class UpdateBienDto {
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
  @MinLength(1)
  nom?: string;

  @IsOptional()
  @IsInt()
  @Min(1800)
  @Max(2100)
  anneeConstruction?: number;

  @IsOptional()
  @IsDateString()
  dateAcquisition?: string;

  @IsOptional()
  @IsNumberString()
  valeurAcquisition?: string;

  @IsOptional()
  @IsIn(TYPES_HABITAT)
  typeHabitat?: (typeof TYPES_HABITAT)[number];

  @IsOptional()
  @IsIn(REGIMES_JURIDIQUES)
  regimeJuridique?: (typeof REGIMES_JURIDIQUES)[number];

  @IsOptional()
  @IsString()
  syndic?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  nbLots?: number;

  @IsOptional()
  @IsNumberString()
  chargesCoproAnnuelles?: string;
}
