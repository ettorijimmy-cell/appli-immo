import type { LocataireStatutEtudes } from "./api";

// Statut d'études du locataire (chantier garants, 2026-11-08), dans l'ordre
// du menu. Sert aux règles de la caution personne physique (loi n° 89-462,
// art. 22-1) : « Non renseigné » compte comme « Ni étudiant ni apprenti ».
export const STATUTS_ETUDES: LocataireStatutEtudes[] = [
  "non_renseigne",
  "aucun",
  "etudiant_boursier",
  "etudiant_non_boursier",
  "apprenti"
];

export const LIBELLES_STATUT_ETUDES: Record<LocataireStatutEtudes, string> = {
  non_renseigne: "Non renseigné",
  aucun: "Ni étudiant ni apprenti",
  etudiant_boursier: "Étudiant boursier",
  etudiant_non_boursier: "Étudiant non boursier",
  apprenti: "Apprenti"
};
