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

  // Adresse du garant, imprimée dans le bail si renseignée. Jamais exigée
  // par validerCompletudeGenerationBail (décision du 2026-11-07, option A,
  // en attendant la lecture du texte sur les mentions de l'acte).
  @IsOptional()
  @IsString()
  adresse?: string;

  @IsOptional()
  @IsString()
  codePostal?: string;

  @IsOptional()
  @IsString()
  ville?: string;

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

  // Locataire dont ce garant se porte caution (facultatif) : doit être
  // rattaché au même bail (lien bail_locataires non archivé), sinon refus
  // (GarantsService). Absent = « non précisé ».
  @IsOptional()
  @IsUUID()
  locataireId?: string;
}
