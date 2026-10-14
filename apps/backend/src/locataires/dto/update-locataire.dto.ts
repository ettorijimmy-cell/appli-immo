import { IsDateString, IsEmail, IsIn, IsOptional, IsString, MinLength, ValidateIf } from "class-validator";

// "archive" en est exclu : l'archivage passe exclusivement par l'endpoint
// dédié /locataires/:id/archiver (même principe que les autres entités).
const LOCATAIRE_STATUTS_MODIFIABLES = ["actif", "ancien"] as const;

export class UpdateLocataireDto {
  // @ValidateIf (pas @IsOptional) : nom/prenom ne doivent jamais pouvoir
  // passer à null — colonnes NOT NULL en base (packages/db/src/schema/
  // locataires.ts). @IsOptional() traite `null` comme "absent" et
  // sauterait @IsString/@MinLength, laissant passer un `nom: null`
  // explicite malgré son typage TS `string?` sans `| null` — la requête
  // remonterait alors jusqu'à une violation de contrainte Postgres
  // NOT NULL, exposée en 500 au lieu d'un 400 propre (même correctif que
  // numero sur UpdateAppartementDto, point 6c, docs/backlog.md).
  @ValidateIf((o) => o.nom !== undefined)
  @IsString()
  @MinLength(1)
  nom?: string;

  @ValidateIf((o) => o.prenom !== undefined)
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
