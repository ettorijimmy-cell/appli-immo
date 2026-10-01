import { Transform } from "class-transformer";
import { IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, Matches, MinLength } from "class-validator";
import { normaliserMontant } from "core";
import { DEPENSE_CATEGORIES, type DepenseCategorie } from "../depense-categories";

export class CreateDepenseDto {
  @IsIn(DEPENSE_CATEGORIES)
  categorie!: DepenseCategorie;

  // Normalise virgule/point/espaces avant validation — même définition que
  // CreatePaiementDto.montant, partagée avec le rapprochement CSV
  // (packages/core, normaliserMontant). @Matches rejette explicitement un
  // signe négatif : une dépense est toujours un montant positif, contrairement
  // aux lignes de relevé CSV signées (parserReleveCsv, débit négatif —
  // convention du domaine paiements/rapprochement, jamais celle de depense.
  // montant). Défense en profondeur : le frontend applique déjà
  // valeurAbsolueMontant avant l'appel pour une ligne de débit importée,
  // ce garde-fou couvre tout autre appelant (revue financial-logic-reviewer,
  // 2026-09-07).
  @Transform(({ value }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: "montant doit être un nombre positif" })
  montant!: string;

  @IsDateString()
  dateDepense!: string;

  @IsString()
  @MinLength(1)
  libelle!: string;

  // bienId, sciId et/ou appartementId — au moins l'un des trois requis
  // (voir DepensesService.create, qui reproduit la contrainte
  // depense_rattachement_requis en base pour un message clair avant la
  // contrainte SQL — celle-ci ne porte que sur bienId/sciId, jamais
  // violée par appartementId seul car DepensesService.create dérive
  // toujours bienId depuis appartements.bien_id dans ce cas).
  @IsOptional()
  @IsUUID()
  bienId?: string;

  // Utile uniquement si bienId est absent (dépense de niveau SCI, sans
  // bien précis — frais de gestion, comptable). Si bienId est fourni,
  // DepensesService.create dérive sciId depuis bien.sciId et ignore cette
  // valeur — jamais une incohérence entre le bien réel et le sciId transmis
  // par le client.
  @IsOptional()
  @IsUUID()
  sciId?: string;

  // Module Régularisation des charges, Sous-commit A — granularité
  // optionnelle sous bienId : une dépense imputable à un logement précis
  // (réparation dans l'appartement 3B), par opposition à une charge
  // commune d'immeuble (appartementId absent, bienId seul). Si bienId est
  // également transmis, DepensesService.create rejette toute incohérence
  // (appartement n'appartenant pas au bien désigné) plutôt que de la
  // laisser passer silencieusement ; si bienId est absent, il est dérivé
  // depuis appartements.bien_id.
  @IsOptional()
  @IsUUID()
  appartementId?: string;
}
