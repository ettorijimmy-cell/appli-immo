import { Transform } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsOptional, IsUUID, Min } from "class-validator";

export const DOCUMENT_ENTITE_TYPES = [
  "sci",
  "immeuble",
  "appartement",
  "locataire",
  "bail",
  "etat_des_lieux"
] as const;
export type DocumentEntiteType = (typeof DOCUMENT_ENTITE_TYPES)[number];

export const DOCUMENT_CATEGORIES = [
  "bail",
  "assurance",
  "etat_des_lieux",
  "diagnostic",
  "dpe",
  "piece_identite",
  "rib",
  "caf",
  "quittance",
  "courrier",
  "photo"
] as const;
export type DocumentCategorie = (typeof DOCUMENT_CATEGORIES)[number];

// Correspond exactement aux étapes "piece-*" du parcours mobile pas-à-pas
// (apps/mobile-web/src/etat-des-lieux/stepper-config.ts), sans le préfixe
// "piece-" — voir packages/db/src/schema/documents.ts.
export const DOCUMENT_ETAT_DES_LIEUX_PIECE_TYPES = [
  "entree",
  "sejour",
  "cuisine",
  "chambre",
  "salle_de_bain",
  "wc",
  "autre"
] as const;
export type DocumentEtatDesLieuxPieceType = (typeof DOCUMENT_ETAT_DES_LIEUX_PIECE_TYPES)[number];

export class CreateDocumentDto {
  @IsIn(DOCUMENT_ENTITE_TYPES)
  entiteType!: DocumentEntiteType;

  @IsUUID()
  entiteId!: string;

  @IsIn(DOCUMENT_CATEGORIES)
  categorie!: DocumentCategorie;

  @IsOptional()
  @IsDateString()
  dateExpiration?: string;

  // Uniquement significatif quand entiteType = 'etat_des_lieux' — vérifié
  // applicativement dans DocumentsService.upload (même principe que
  // verifierEntiteExiste, pas de contrainte DB possible sur un couple
  // conditionnel).
  @IsOptional()
  @IsIn(DOCUMENT_ETAT_DES_LIEUX_PIECE_TYPES)
  etatDesLieuxPieceType?: DocumentEtatDesLieuxPieceType;

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === "" ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  etatDesLieuxPieceNumero?: number;
}
