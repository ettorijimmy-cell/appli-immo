// Correspondance entre depense.categorie (packages/db/src/schema/depense.ts,
// 7 valeurs) et les lignes automatiques de l'Annexe 1 (2072-S-A1-SD, cadre
// VII) qu'elle alimente — fixée par le mapping validé à l'Étape 1 des
// catégories de dépenses (docs/backlog.md), pas une nomenclature arbitraire.
// "autre" n'alimente aucune ligne de l'Annexe 1, volontairement absente.
// Typé en chaînes plutôt que sur l'enum depense_categorie (packages/db,
// apps/backend uniquement) pour que packages/core reste sans dépendance
// vers un package consommateur.
export const LIGNE_ANNEXE1_PAR_CATEGORIE_DEPENSE: Record<string, "ligne6" | "ligne8" | "ligne9" | "ligne12" | "ligne13" | "ligne17"> = {
  frais_gestion: "ligne6",
  assurance: "ligne8",
  reparation_entretien: "ligne9",
  impots_taxes: "ligne12",
  charges_copropriete: "ligne13",
  interets_emprunt: "ligne17"
};
