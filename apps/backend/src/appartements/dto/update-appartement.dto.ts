import { IsIn, IsInt, IsNumberString, IsOptional, IsString, Min, MinLength } from "class-validator";

const APPARTEMENT_TYPES = ["T1", "T2", "T3", "T4", "T5", "T6"] as const;
const MODES_PRODUCTION = ["individuel", "collectif"] as const;
// "archive" en est exclu : l'archivage passe exclusivement par l'endpoint
// dédié /appartements/:id/archiver, qui pose aussi archivedAt — un statut
// "archive" posé ici casserait l'invariant archive <=> archivedAt renseigné.
const APPARTEMENT_STATUTS_MODIFIABLES = ["vacant", "loue", "travaux"] as const;

export class UpdateAppartementDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  numero?: string;

  @IsOptional()
  @IsIn(APPARTEMENT_TYPES)
  type?: (typeof APPARTEMENT_TYPES)[number];

  @IsOptional()
  @IsNumberString()
  surface?: string;

  @IsOptional()
  @IsNumberString()
  loyerReference?: string;

  @IsOptional()
  @IsString()
  equipementCuisine?: string;

  @IsOptional()
  @IsString()
  dependancesAnnexes?: string;

  // Facultatifs ici (contrairement à CreateAppartementDto) : un
  // appartement créé avant que ces champs deviennent obligatoires à la
  // création doit rester modifiable normalement.
  @IsOptional()
  @IsInt()
  @Min(1)
  nombrePiecesPrincipales?: number;

  @IsOptional()
  @IsIn(MODES_PRODUCTION)
  modeChauffage?: (typeof MODES_PRODUCTION)[number];

  @IsOptional()
  @IsIn(MODES_PRODUCTION)
  modeEauChaude?: (typeof MODES_PRODUCTION)[number];

  // Passage manuel vacant / loue / travaux — l'automatisation vacant <-> loue
  // via la création/résiliation de bail arrive au Module 3 ; le réglage
  // manuel restera disponible pour correction de saisie, sauf décision
  // contraire à ce moment-là (voir docs/backlog.md, Module 3).
  @IsOptional()
  @IsIn(APPARTEMENT_STATUTS_MODIFIABLES)
  statut?: (typeof APPARTEMENT_STATUTS_MODIFIABLES)[number];
}
