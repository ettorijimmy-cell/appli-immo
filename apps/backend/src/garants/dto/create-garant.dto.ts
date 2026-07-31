import { IsDateString, IsEmail, IsIn, IsOptional, IsString, IsUUID, MinLength } from "class-validator";

const GARANT_TYPES_GARANTIE = ["personne_physique", "garantie_visale", "autre"] as const;

export class CreateGarantDto {
  @IsUUID()
  bailId!: string;

  @IsString()
  @MinLength(1)
  nom!: string;

  @IsString()
  @MinLength(1)
  prenom!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  telephone?: string;

  @IsIn(GARANT_TYPES_GARANTIE)
  typeGarantie!: (typeof GARANT_TYPES_GARANTIE)[number];

  // Mentions manuscrites de l'acte de cautionnement — figées à la
  // création, comme adresse/profession/revenus (voir schéma garants).
  @IsOptional()
  @IsDateString()
  dateNaissance?: string;

  @IsOptional()
  @IsString()
  lieuNaissance?: string;

  @IsOptional()
  @IsString()
  nationalite?: string;
}
