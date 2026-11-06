import { IsNotEmpty, IsString, MaxLength } from "class-validator";
import { LONGUEUR_MAX_MOTIF_ABANDON } from "core";

// Motif court obligatoire (décision du 2026-11-05) : conservé avec le
// brouillon archivé, affiché dans la liste des brouillons abandonnés.
// Une chaîne faite d'espaces est refusée par le service (après trim).
export class AbandonnerEtatDesLieuxDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(LONGUEUR_MAX_MOTIF_ABANDON)
  motif!: string;
}
