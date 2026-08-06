import { Type } from "class-transformer";
import { IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Min, MinLength, ValidateNested } from "class-validator";

export const ETATS_INVENTAIRE = ["bon", "dusage", "mauvais"] as const;
export type EtatInventaire = (typeof ETATS_INVENTAIRE)[number];

class LigneEquipementDiversDto {
  // Identifie une ligne déjà enregistrée (renvoyée par un GET précédent).
  // Absent = nouvelle ligne. Jamais de correspondance implicite par
  // libellé (texte libre, pas une clé stable) — voir
  // EtatsDesLieuxService.upsertEtArchiverParId.
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @MinLength(1)
  libelle!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  nombreEntree?: number;

  @IsOptional()
  @IsIn(ETATS_INVENTAIRE)
  etatEntree?: EtatInventaire;

  @IsOptional()
  @IsInt()
  @Min(0)
  nombreSortie?: number;

  @IsOptional()
  @IsIn(ETATS_INVENTAIRE)
  etatSortie?: EtatInventaire;

  @IsOptional()
  @IsString()
  commentaire?: string;
}

// Liste extensible, libellé saisi librement — pas de catalogue fixe
// (décision du propriétaire). Upsert par id explicite, jamais un
// remplacement en bloc — voir SubmitClesDto pour le raisonnement complet
// (perte silencieuse des valeurs d'entrée sinon).
export class SubmitEquipementsDiversDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LigneEquipementDiversDto)
  lignes!: LigneEquipementDiversDto[];

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  idsASupprimer?: string[];
}
