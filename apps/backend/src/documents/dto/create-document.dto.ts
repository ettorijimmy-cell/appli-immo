import { IsDateString, IsIn, IsOptional, IsUUID } from "class-validator";

export const DOCUMENT_ENTITE_TYPES = ["sci", "immeuble", "appartement", "locataire", "bail"] as const;
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
}
