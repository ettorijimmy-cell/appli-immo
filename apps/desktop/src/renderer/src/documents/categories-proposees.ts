import type { DocumentCategorie, DocumentEntiteType } from "./api";

// Catégories proposées au dépôt d'un document (DocumentUploadDropzone).
const CATEGORIES_GENERALES: DocumentCategorie[] = [
  "bail",
  "assurance",
  "etat_des_lieux",
  "diagnostic",
  "dpe",
  "elec_gaz",
  "crep_plomb",
  "erp",
  "piece_identite",
  "rib",
  "caf",
  "quittance",
  "courrier",
  "photo"
];

// Garant (chantier garants, 2026-11-08) : ses pièces d'abord — pièce
// d'identité (caution), contrat de cautionnement Visale, acte de
// cautionnement signé —, puis les catégories générales.
const CATEGORIES_GARANT: DocumentCategorie[] = [
  "piece_identite",
  "contrat_cautionnement_visale",
  "acte_cautionnement_signe",
  ...CATEGORIES_GENERALES.filter((c) => c !== "piece_identite")
];

// La première catégorie est celle sélectionnée par défaut.
export function categoriesProposees(entiteType: DocumentEntiteType): DocumentCategorie[] {
  return entiteType === "garant" ? CATEGORIES_GARANT : CATEGORIES_GENERALES;
}
