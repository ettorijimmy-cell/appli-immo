import { IsEmail, IsIn, IsOptional, IsString, MinLength } from "class-validator";

const GARANT_TYPES_GARANTIE = ["personne_physique", "garantie_visale", "autre"] as const;

export class UpdateGarantDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  nom?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  prenom?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  telephone?: string;

  @IsOptional()
  @IsIn(GARANT_TYPES_GARANTIE)
  typeGarantie?: (typeof GARANT_TYPES_GARANTIE)[number];
}
