/**
 * Règle de gestion (docs/backlog.md, Module 3) : à la création d'un bail,
 * le loyer est pré-rempli depuis `loyer_reference` de l'appartement si
 * aucune valeur n'est saisie explicitement. Une saisie explicite — y
 * compris une chaîne vide résultant d'un champ formulaire vidé — prévaut
 * toujours sur la référence.
 */
export function preremplirLoyerBail(
  loyerSaisi: string | undefined,
  loyerReferenceAppartement: string | null
): string | null {
  if (loyerSaisi !== undefined) {
    return loyerSaisi;
  }
  return loyerReferenceAppartement;
}
