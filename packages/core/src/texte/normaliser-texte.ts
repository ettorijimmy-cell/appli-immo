/**
 * Normalisation partagée pour toute comparaison "un texte en contient un
 * autre" (nom de locataire dans un libellé bancaire, mot-clé de
 * catégorisation dans un libellé bancaire...) : casse, accents et
 * ponctuation neutralisés. Extrait de proposer-rapprochements.ts
 * (2026-09-11, Module Charges et fiscalité Étape 2) pour être réutilisé
 * par suggererCategorie — même besoin, domaines différents (rapprochement
 * de paiements vs catégorisation de dépenses), comportement inchangé.
 */
export function normaliserPourCorrespondance(texte: string): string {
  return texte
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Correspondance partielle insensible à la casse/aux accents/à la
 * ponctuation — retourne false si `motif` est vide après normalisation
 * (jamais un "tout contient une chaîne vide" trivialement vrai).
 */
export function libelleContient(libelle: string, motif: string): boolean {
  const motifNormalise = normaliserPourCorrespondance(motif);
  if (motifNormalise === "") {
    return false;
  }
  return normaliserPourCorrespondance(libelle).includes(motifNormalise);
}
