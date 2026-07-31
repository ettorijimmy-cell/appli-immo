import type { Content } from "pdfmake/interfaces";
import type { DonneesSectionV } from "../types";

/**
 * Section V ("Travaux"). Mention obligatoire des travaux réalisés depuis
 * le dernier bail — texte libre par nature (`baux.travaux_realises`),
 * "néant" si absent.
 */
export function construireSectionV(donnees: DonneesSectionV): Content {
  return [
    { text: "V. Travaux", style: "titreSection" },
    {
      text: `Travaux d'amélioration réalisés depuis le dernier contrat de location : ${donnees.travauxRealises ?? "néant"}.`,
      margin: [0, 4, 0, 8]
    }
  ];
}
