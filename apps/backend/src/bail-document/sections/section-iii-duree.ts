import { calculerDureeBail } from "core";
import type { Content } from "pdfmake/interfaces";
import type { DonneesSectionIII } from "../types";

/**
 * Section III ("Date de prise d'effet et durée du contrat"). La durée
 * n'est jamais déduite silencieusement — `choixDuree` est un choix humain
 * explicite fourni à la génération (docs/data-dictionary.md, section
 * "Édition d'un bail"), jamais une valeur par défaut imposée.
 */
export function construireSectionIII(donnees: DonneesSectionIII): Content {
  const { duree, texteLegal } = calculerDureeBail(donnees.choixDuree);

  return [
    { text: "III. Date de prise d'effet et durée du contrat", style: "titreSection" },
    {
      text: `Le présent contrat prend effet le ${donnees.dateDebut} pour une durée de ${duree}.`,
      margin: [0, 4, 0, 4]
    },
    { text: texteLegal, margin: [0, 0, 0, 8] }
  ];
}
