import { Transform } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsOptional, Min } from "class-validator";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_ETAT_DES_LIEUX_PIECE_TYPES,
  type DocumentCategorie,
  type DocumentEtatDesLieuxPieceType
} from "./create-document.dto";

// entiteType/entiteId ne figurent volontairement pas ici : un remplacement
// est toujours rattaché à la même entité que la version qu'il remplace
// (héritée de documentPrecedentId, jamais re-saisie) — impossible de
// rattacher par erreur un remplacement à la mauvaise entité.
export class RemplacerDocumentDto {
  @IsIn(DOCUMENT_CATEGORIES)
  categorie!: DocumentCategorie;

  @IsOptional()
  @IsDateString()
  dateExpiration?: string;

  @IsOptional()
  @IsIn(DOCUMENT_ETAT_DES_LIEUX_PIECE_TYPES)
  etatDesLieuxPieceType?: DocumentEtatDesLieuxPieceType;

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === "" ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  etatDesLieuxPieceNumero?: number;
}
