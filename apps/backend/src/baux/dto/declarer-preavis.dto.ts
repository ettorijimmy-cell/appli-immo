import { MOTIFS_PREAVIS_REDUIT, type AuteurPreavis, type MotifPreavisReduit } from "core";
import { IsIn, IsInt, IsOptional, Matches } from "class-validator";

const FORMAT_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MODES_REMISE_PREAVIS = ["lrar", "commissaire_justice", "main_propre"] as const;
export type ModeRemisePreavis = (typeof MODES_REMISE_PREAVIS)[number];

// Déclaration ou correction d'un préavis (résiliation, conception 2 « vrai
// préavis », décisions de Jimmy du 2026-11-15). Format seulement ici : la
// cohérence (motif, durée, dates, contre le bail) est vérifiée par
// validerDeclarationPreavis (packages/core) dans PreavisService.
// Une correction renvoie la déclaration complète (nouvelle ligne).
export class DeclarerPreavisDto {
  @IsIn(["locataire", "bailleur"], { message: "Auteur du congé invalide (locataire ou bailleur)." })
  auteur!: AuteurPreavis;

  @Matches(FORMAT_DATE, { message: "La date de réception du congé doit être au format AAAA-MM-JJ." })
  dateReception!: string;

  @IsOptional()
  @IsIn(MODES_REMISE_PREAVIS, { message: "Mode de remise du congé invalide." })
  modeRemise?: ModeRemisePreavis | null;

  @IsInt({ message: "La durée du préavis doit être un nombre entier de mois." })
  dureeMois!: number;

  @IsOptional()
  @IsIn(MOTIFS_PREAVIS_REDUIT, { message: "Motif de préavis réduit invalide." })
  motifReduit?: MotifPreavisReduit | null;

  // Date de fin CONFIRMÉE (ou corrigée) par Jimmy ; la date proposée par
  // Briky est recalculée par le serveur et gardée à côté.
  @Matches(FORMAT_DATE, { message: "La date de fin du préavis doit être au format AAAA-MM-JJ." })
  dateFin!: string;
}
