import { Type } from "class-transformer";
import { IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Min, ValidateNested } from "class-validator";
import { ETATS_INVENTAIRE, type EtatInventaire } from "./submit-equipements-divers.dto";

class LigneInventaireDto {
  // Contrairement à clés/équipements divers, une clé naturelle stable
  // existe déjà (contrainte d'unicité (etat_des_lieux_id, element_id) en
  // base) — pas besoin d'un id de ligne allé-retour, elementId suffit à
  // l'upsert.
  @IsUUID()
  elementId!: string;

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

// Pertinent uniquement pour un bail meublé — règle applicative (côté
// service/UI), aucune contrainte de schéma ne l'impose. Upsert par
// elementId, jamais un remplacement en bloc — voir SubmitClesDto pour le
// raisonnement complet (perte silencieuse des valeurs d'entrée sinon).
export class SubmitInventaireDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LigneInventaireDto)
  lignes!: LigneInventaireDto[];

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  elementsASupprimer?: string[];
}
