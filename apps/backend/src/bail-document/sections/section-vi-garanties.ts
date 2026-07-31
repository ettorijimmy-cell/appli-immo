import type { Content } from "pdfmake/interfaces";
import type { DonneesSectionVI } from "../types";

/** Section VI ("Garanties") : montant du dépôt de garantie. */
export function construireSectionVI(donnees: DonneesSectionVI): Content {
  return [
    { text: "VI. Garanties", style: "titreSection" },
    {
      text: donnees.depotGarantie
        ? `Un dépôt de garantie de ${donnees.depotGarantie} € est versé par le locataire à la signature du présent contrat.`
        : "Aucun dépôt de garantie n'est exigé.",
      margin: [0, 4, 0, 8]
    }
  ];
}
