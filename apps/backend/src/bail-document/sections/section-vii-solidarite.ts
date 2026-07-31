import type { Content } from "pdfmake/interfaces";
import type { DonneesSectionVII } from "../types";

/**
 * Section VII ("Clause de solidarité") — présente uniquement en cas de
 * colocation (plusieurs locataires rattachés au bail via
 * `bail_locataires`). La règle d'extinction à six mois (article 8-1 de la
 * loi n° 89-462) ne concerne QUE ce cas de colocation à bail unique — elle
 * n'est donc jamais affichée pour un locataire seul
 * (docs/data-dictionary.md, section "Édition d'un bail").
 */
export function construireSectionVII(donnees: DonneesSectionVII): Content {
  if (donnees.nombreLocataires <= 1) {
    return [
      { text: "VII. Clause de solidarité", style: "titreSection" },
      { text: "Sans objet (un seul locataire).", margin: [0, 4, 0, 8] }
    ];
  }

  return [
    { text: "VII. Clause de solidarité", style: "titreSection" },
    {
      text: "En cas de pluralité de locataires, chacun d'eux est solidairement et indivisiblement tenu au paiement du loyer, des charges et à l'exécution de l'ensemble des obligations résultant du présent contrat. La solidarité d'un colocataire et de sa caution prend fin à la date d'effet de son congé régulièrement délivré si un nouveau colocataire figure au bail ; à défaut, elle s'éteint au plus tard six mois après cette date (article 8-1 de la loi n° 89-462 du 6 juillet 1989).",
      margin: [0, 4, 0, 8]
    }
  ];
}
