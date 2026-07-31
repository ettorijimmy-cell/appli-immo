import { IsDateString, IsEmail, IsIn, IsOptional, IsString, MinLength } from "class-validator";

// "archive" en est exclu : l'archivage passe exclusivement par l'endpoint
// dédié /locataires/:id/archiver (même principe que les autres entités).
const LOCATAIRE_STATUTS_MODIFIABLES = ["actif", "ancien"] as const;

export class UpdateLocataireDto {
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
  @IsString()
  adresse?: string;

  @IsOptional()
  @IsString()
  codePostal?: string;

  @IsOptional()
  @IsString()
  ville?: string;

  @IsOptional()
  @IsDateString()
  dateNaissance?: string;

  @IsOptional()
  @IsIn(LOCATAIRE_STATUTS_MODIFIABLES)
  statut?: (typeof LOCATAIRE_STATUTS_MODIFIABLES)[number];
}
