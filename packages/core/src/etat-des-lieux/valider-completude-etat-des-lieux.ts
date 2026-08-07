/**
 * Vérifie que la composition réelle du logement est connue AVANT de
 * démarrer un état des lieux — jamais un parcours pas-à-pas mobile lancé
 * à zéro étape (nombre de chambres inconnu) ni deviné (docs/data-
 * dictionary.md, section "appartements"). Même principe que
 * `validerCompletudeGenerationBail` : liste complète des champs manquants
 * en un seul appel, jamais un blocage au premier trouvé.
 *
 * `autrePiece1`/`autrePiece2` ne sont volontairement PAS vérifiés ici :
 * 0, 1 ou 2 "autres pièces" sont des états légitimes, jamais traités
 * comme une donnée manquante.
 */

export interface DonneesCompletudeEtatDesLieuxAppartement {
  nombreChambres: number | null;
  nombreSallesDeBain: number | null;
  nombreWc: number | null;
}

export function validerCompletudeEtatDesLieux(
  appartement: DonneesCompletudeEtatDesLieuxAppartement
): string[] {
  const manquants: string[] = [];

  if (appartement.nombreChambres === null) {
    manquants.push("Nombre de chambres de l'appartement");
  }
  if (appartement.nombreSallesDeBain === null) {
    manquants.push("Nombre de salles de bain de l'appartement");
  }
  if (appartement.nombreWc === null) {
    manquants.push("Nombre de WC de l'appartement");
  }

  return manquants;
}
