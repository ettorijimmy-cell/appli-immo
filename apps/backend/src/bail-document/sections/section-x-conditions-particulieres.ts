import type { Content } from "pdfmake/interfaces";
import type { DonneesSectionX } from "../types";

/** Section X ("Autres conditions particulières") — texte libre, optionnel. */
export function construireSectionX(donnees: DonneesSectionX): Content {
  return [
    { text: "X. Autres conditions particulières", style: "titreSection" },
    {
      text: donnees.conditionsParticulieres ?? "Néant.",
      margin: [0, 4, 0, 8]
    }
  ];
}
