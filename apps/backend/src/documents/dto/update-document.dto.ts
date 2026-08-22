import { IsDateString, IsIn, IsOptional } from "class-validator";
import { DOCUMENT_CATEGORIES, type DocumentCategorie } from "./create-document.dto";

// Corrige une catégorie ou une date d'expiration mal saisies à l'upload —
// jamais le fichier lui-même : remplacer le contenu passe par
// DocumentsService.remplacerDocument() (nouvelle version chaînée via
// document_precedent_id, ancienne archivée), pas par cette route.
export class UpdateDocumentDto {
  @IsOptional()
  @IsIn(DOCUMENT_CATEGORIES)
  categorie?: DocumentCategorie;

  @IsOptional()
  @IsDateString()
  dateExpiration?: string;
}
