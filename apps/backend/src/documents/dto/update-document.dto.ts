import { IsDateString, IsIn, IsOptional } from "class-validator";
import { DOCUMENT_CATEGORIES, type DocumentCategorie } from "./create-document.dto";

// Corrige une catégorie ou une date d'expiration mal saisies à l'upload —
// jamais le fichier lui-même (pas de remplacement de version, hors
// périmètre du Module 4 MVP, voir docs/backlog.md, dette technique).
export class UpdateDocumentDto {
  @IsOptional()
  @IsIn(DOCUMENT_CATEGORIES)
  categorie?: DocumentCategorie;

  @IsOptional()
  @IsDateString()
  dateExpiration?: string;
}
