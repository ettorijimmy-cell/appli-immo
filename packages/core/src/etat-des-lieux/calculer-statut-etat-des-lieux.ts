export type StatutEtatDesLieux = "non_commence" | "entree_terminee" | "complet";

/**
 * Le statut n'est jamais saisi ni stocké : toujours dérivé de
 * date_entree/date_sortie (docs/data-dictionary.md), même principe que
 * calculerStatutPaiement — pas de colonne redondante qui pourrait
 * diverger de l'état réel des dates.
 */
export function calculerStatutEtatDesLieux(
  dateEntree: string | null,
  dateSortie: string | null
): StatutEtatDesLieux {
  if (dateEntree === null) {
    return "non_commence";
  }
  if (dateSortie === null) {
    return "entree_terminee";
  }
  return "complet";
}
