// 7 catégories du Plan Comptable Général alimentant le tableau VII du
// formulaire 2072 (voir packages/db/src/schema/depense.ts) — pas une
// nomenclature arbitraire. Partagé entre CreateDepenseDto et
// CreateRegleCategorisationDto (Étape 2, docs/backlog.md) : les deux
// doivent accepter exactement le même jeu de valeurs que l'enum
// depense_categorie, jamais deux listes qui pourraient diverger.
export const DEPENSE_CATEGORIES = [
  "frais_gestion",
  "assurance",
  "reparation_entretien",
  "impots_taxes",
  "charges_copropriete",
  "interets_emprunt",
  "autre"
] as const;

export type DepenseCategorie = (typeof DEPENSE_CATEGORIES)[number];
