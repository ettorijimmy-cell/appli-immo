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
 *
 * Pour un bien non résidentiel (parking/bureau/local_commercial, voir
 * `estTypeResidentiel`), la notion même de composition du logement
 * (chambres/salles de bain/WC) n'a pas de sens : l'état des lieux est
 * bloqué par un message dédié, AVANT toute autre vérification — même
 * principe que `validerCompletudeGenerationBail` (audit du 2026-08-27,
 * docs/backlog.md).
 */

import { estTypeResidentiel, type TypeBien } from "../biens/type-bien";

export interface DonneesCompletudeEtatDesLieuxAppartement {
  bienType: TypeBien;
  nombreChambres: number | null;
  nombreSallesDeBain: number | null;
  nombreWc: number | null;
}

export function validerCompletudeEtatDesLieux(
  appartement: DonneesCompletudeEtatDesLieuxAppartement
): string[] {
  if (!estTypeResidentiel(appartement.bienType)) {
    return ["État des lieux non disponible pour ce type de bien"];
  }

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
