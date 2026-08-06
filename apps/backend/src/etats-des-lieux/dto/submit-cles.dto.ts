import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Min, ValidateNested } from "class-validator";

export const TYPES_CLE = [
  "immeuble",
  "porte_entree",
  "boite_lettres",
  "cave",
  "badge_portail",
  "parking",
  "autre"
] as const;
export type TypeCle = (typeof TYPES_CLE)[number];

class LigneCleDto {
  // Identifie une ligne déjà enregistrée (renvoyée par un GET précédent).
  // Absent = nouvelle ligne. Jamais de correspondance implicite par
  // contenu (type_cle n'est pas unique à cause des lignes "autre") — voir
  // EtatsDesLieuxService.upsertEtArchiverParId.
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsIn(TYPES_CLE)
  typeCle!: TypeCle;

  // Renseigné uniquement si typeCle = "autre" (2 emplacements libres dans
  // le modèle réel — plusieurs lignes "autre" possibles, distinguées par
  // ce libellé).
  @IsOptional()
  @IsString()
  libelleAutre?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  nombreEntree?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  nombreSortie?: number;

  @IsOptional()
  @IsString()
  commentaire?: string;
}

// Upsert par id explicite (une ligne courte, au plus 8 : 6 types fixes +
// 2 "autre"), jamais un remplacement en bloc — une ligne existante non
// mentionnée dans `lignes` n'est jamais touchée, et n'est supprimée
// (archivée) que si son id figure explicitement dans `idsASupprimer`.
// Nécessaire pour ne jamais perdre silencieusement les valeurs d'entrée
// lors de la soumission de sortie, potentiellement des mois plus tard,
// si le client ne renvoie pas toutes les lignes déjà connues.
export class SubmitClesDto {
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => LigneCleDto)
  lignes!: LigneCleDto[];

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  idsASupprimer?: string[];
}
