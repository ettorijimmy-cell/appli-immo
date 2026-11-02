import { nettoyerTexteObservation } from "core";

// Valeur à soumettre pour un texte de sortie facultatif : undefined quand il
// n'y a rien à changer, null pour effacer un texte déjà enregistré (une clé
// absente laisserait l'ancien texte en base, et donc dans le document).
export function observationSortieASoumettre(
  saisie: string,
  valeurEnregistree: string | null | undefined
): string | null | undefined {
  const texte = nettoyerTexteObservation(saisie);
  return texte !== null || valeurEnregistree ? texte : undefined;
}
