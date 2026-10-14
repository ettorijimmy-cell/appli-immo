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

  // `| null` sur les champs ci-dessous (point 6b, docs/backlog.md) : un
  // champ vidé dans EditLocataireForm doit être envoyé comme `null`
  // explicite pour effacer réellement la valeur en base — omettre la clé
  // laisserait l'ancienne valeur inchangée (même raisonnement que
  // UpdateGarantDto, commit f3513de). nom/prenom restent non vidables.
  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  telephone?: string | null;

  @IsOptional()
  @IsString()
  adresse?: string | null;

  @IsOptional()
  @IsString()
  codePostal?: string | null;

  @IsOptional()
  @IsString()
  ville?: string | null;

  @IsOptional()
  @IsDateString()
  dateNaissance?: string | null;

  @IsOptional()
  @IsIn(LOCATAIRE_STATUTS_MODIFIABLES)
  statut?: (typeof LOCATAIRE_STATUTS_MODIFIABLES)[number];
}
