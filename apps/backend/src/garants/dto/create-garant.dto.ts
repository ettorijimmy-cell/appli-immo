import { IsDateString, IsEmail, IsIn, IsOptional, IsString, IsUUID, MinLength, ValidateIf } from "class-validator";

// Types proposés à la saisie (chantier garants, 2026-11-08). « autre » reste
// dans l'enum de la base (lignes existantes lisibles) mais est refusé en
// création comme en modification.
export const GARANT_TYPES_SAISISSABLES = ["personne_physique", "garantie_visale"] as const;
export type GarantTypeSaisissable = (typeof GARANT_TYPES_SAISISSABLES)[number];
export const MESSAGE_TYPE_GARANTIE_REFUSE =
  "typeGarantie doit être personne_physique (caution) ou garantie_visale : le type « autre » n'est plus accepté";

export class CreateGarantDto {
  @IsUUID()
  bailId!: string;

  // Exigés pour une caution personne physique. Pour une garantie Visale,
  // le serveur impose nom = « Action Logement Services (Visale) » et
  // prénom vide (GarantsService) : valeurs reçues ignorées.
  @ValidateIf((o) => o.typeGarantie !== "garantie_visale")
  @IsString()
  @MinLength(1)
  nom?: string;

  @ValidateIf((o) => o.typeGarantie !== "garantie_visale")
  @IsString()
  @MinLength(1)
  prenom?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  telephone?: string;

  @IsIn(GARANT_TYPES_SAISISSABLES, { message: MESSAGE_TYPE_GARANTIE_REFUSE })
  typeGarantie!: GarantTypeSaisissable;

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

  // Numéro du contrat de cautionnement Visale (garantie_visale seulement,
  // ignoré pour une caution personne physique).
  @IsOptional()
  @IsString()
  numeroContratVisale?: string;
}
