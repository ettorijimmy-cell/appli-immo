import { IsDateString, IsEmail, IsIn, IsOptional, IsString, MinLength } from "class-validator";

export const LOCATAIRE_STATUTS_ETUDES = [
  "non_renseigne",
  "aucun",
  "etudiant_boursier",
  "etudiant_non_boursier",
  "apprenti"
] as const;

export class CreateLocataireDto {
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

  // Statut d'études (chantier garants, 2026-11-08) : règles d'acceptation
  // d'une caution personne physique (packages/core, verifierGarantiesBail).
  @IsOptional()
  @IsIn(LOCATAIRE_STATUTS_ETUDES)
  statutEtudes?: (typeof LOCATAIRE_STATUTS_ETUDES)[number];
}
