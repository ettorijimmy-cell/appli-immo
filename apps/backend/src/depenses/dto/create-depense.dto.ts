import { Transform } from "class-transformer";
import { IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, Matches, MinLength } from "class-validator";
import { normaliserMontant } from "core";

// 7 catégories du Plan Comptable Général alimentant le tableau VII du
// formulaire 2072 (voir packages/db/src/schema/depense.ts) — pas une
// nomenclature arbitraire.
const DEPENSE_CATEGORIES = [
  "frais_gestion",
  "assurance",
  "reparation_entretien",
  "impots_taxes",
  "charges_copropriete",
  "interets_emprunt",
  "autre"
] as const;

export class CreateDepenseDto {
  @IsIn(DEPENSE_CATEGORIES)
  categorie!: (typeof DEPENSE_CATEGORIES)[number];

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

  // bienId et/ou sciId — au moins l'un des deux requis (contrainte
  // depense_rattachement_requis en base), vérifié dans DepensesService
  // .create pour un message clair avant la contrainte SQL.
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
}
