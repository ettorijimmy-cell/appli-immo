export type TrancheConstruction =
  | "avant_1949"
  | "de_1949_a_1974"
  | "de_1975_a_1989"
  | "de_1989_a_2005"
  | "depuis_2005";

/**
 * Tranches exactes de l'annexe 1 du décret n° 2015-587 (contrat-type de
 * location vide), pas les tranches — plus fines — de la méthode 3CL-DPE,
 * volontairement différentes et à ne jamais fusionner
 * (docs/data-dictionary.md, section "Édition d'un bail").
 *
 * Le texte officiel ("avant 1949 / de 1949 à 1974 / de 1975 à 1989 / de
 * 1989 à 2005 / depuis 2005") cite 1989 et 2005 dans deux tranches
 * adjacentes à la fois — un chevauchement propre aux exemples illustratifs
 * du contrat-type, pas une erreur à reproduire. Résolu ici en faisant
 * appartenir l'année charnière à la tranche suivante seulement.
 */
export function calculerTrancheConstruction(anneeConstruction: number): TrancheConstruction {
  if (anneeConstruction < 1949) {
    return "avant_1949";
  }
  if (anneeConstruction <= 1974) {
    return "de_1949_a_1974";
  }
  if (anneeConstruction <= 1988) {
    return "de_1975_a_1989";
  }
  if (anneeConstruction <= 2004) {
    return "de_1989_a_2005";
  }
  return "depuis_2005";
}

const LIBELLES: Record<TrancheConstruction, string> = {
  avant_1949: "avant 1949",
  de_1949_a_1974: "de 1949 à 1974",
  de_1975_a_1989: "de 1975 à 1989",
  de_1989_a_2005: "de 1989 à 2005",
  depuis_2005: "depuis 2005"
};

export function libelleTrancheConstruction(tranche: TrancheConstruction): string {
  return LIBELLES[tranche];
}
