export const LONGUEUR_MAX_OBSERVATIONS_GENERALES = 2_000;
export const LONGUEUR_MAX_OBSERVATION_SORTIE = 500;

// Texte libre destiné à un document à valeur légale : fins de ligne unifiées,
// caractères de contrôle retirés (invalides dans le XML du document Word, ils
// en feraient échouer la génération), espaces autour retirés. Une saisie vide
// revient à ne rien saisir.
export function nettoyerTexteObservation(texte: string): string | null {
  const nettoye = texte
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex -- ces caractères sont justement ceux à retirer.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  return nettoye === "" ? null : nettoye;
}

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
