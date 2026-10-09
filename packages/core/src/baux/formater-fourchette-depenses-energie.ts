/**
 * Mention "Dépenses énergétiques (pour information)" du contrat-type
 * (décret n° 2015-587, annexes 1 et 2 — texte identique vide/meublé).
 * Un montant unique inscrit au DPE se saisit sur la fiche appartement dans
 * les deux champs (`depensesEnergieMin = depensesEnergieMax`) — affiché ici
 * comme un montant unique, jamais comme une fourchette dégénérée
 * ("entre 150 et 150"). `null` si l'un des deux champs est absent : à
 * l'appelant de décider du comportement (mention "à compléter").
 *
 * Jamais de "€" dans la valeur retournée — même convention que les autres
 * montants du bail (loyer, dépôt de garantie, charges) : le chiffre seul,
 * le symbole monétaire vit dans le texte fixe du modèle autour de la
 * balise, jamais dans la valeur substituée.
 */
export function formaterFourchetteDepensesEnergie(
  min: string | null | undefined,
  max: string | null | undefined
): string | null {
  if (min === null || min === undefined || max === null || max === undefined) {
    return null;
  }
  if (Number(min) === Number(max)) {
    return min;
  }
  return `entre ${min} et ${max}`;
}
