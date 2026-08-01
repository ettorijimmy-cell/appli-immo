/**
 * Libellé légal du dépôt de garantie (article 22 de la loi n° 89-462) :
 * un mois de loyer hors charges pour un bail vide, deux mois pour un bail
 * meublé — texte affiché dans le modèle de bail, distinct du montant
 * lui-même (`baux.depot_garantie`, saisi séparément, non vérifié ici).
 */
export function calculerLibelleDepotGarantie(typeBail: "vide" | "meuble"): string {
  return typeBail === "vide" ? "un mois" : "deux mois";
}
