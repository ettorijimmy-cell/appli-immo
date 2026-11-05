import { IsNotEmpty, IsString, MaxLength } from "class-validator";

// Motif court obligatoire (décision du 2026-11-05) : conservé avec le
// brouillon archivé, affiché dans la liste des brouillons abandonnés.
// Une chaîne faite d'espaces est refusée par le service (après trim).
export class AbandonnerEtatDesLieuxDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  motif!: string;
}
