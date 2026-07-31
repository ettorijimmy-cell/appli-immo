import type { Content } from "pdfmake/interfaces";
import type { DonneesSectionIX } from "../types";

/**
 * Section IX ("Honoraires de location") — champ optionnel
 * (`baux.honoraires_bailleur`/`honoraires_locataire`), "néant" par défaut
 * (docs/data-dictionary.md, section "Édition d'un bail") : sans objet tant
 * qu'aucun professionnel n'intervient dans la location.
 */
export function construireSectionIX(donnees: DonneesSectionIX): Content {
  if (!donnees.honorairesBailleur && !donnees.honorairesLocataire) {
    return [
      { text: "IX. Honoraires de location", style: "titreSection" },
      { text: "Néant.", margin: [0, 4, 0, 8] }
    ];
  }

  const lignes: string[] = [];
  if (donnees.honorairesBailleur) {
    lignes.push(`Part à la charge du bailleur : ${donnees.honorairesBailleur} €`);
  }
  if (donnees.honorairesLocataire) {
    lignes.push(`Part à la charge du locataire : ${donnees.honorairesLocataire} €`);
  }

  return [
    { text: "IX. Honoraires de location", style: "titreSection" },
    { ul: lignes, margin: [0, 4, 0, 8] }
  ];
}
