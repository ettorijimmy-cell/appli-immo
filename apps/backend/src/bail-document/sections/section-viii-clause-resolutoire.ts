import { construireTexteClauseResolutoire, determinerRegimeClauseResolutoire } from "core";
import type { Content } from "pdfmake/interfaces";
import type { DonneesSectionVIII } from "../types";

/**
 * Section VIII ("Clause résolutoire") — deux régimes selon la date de
 * référence (voir packages/core, calculerClauseResolutoire) : jamais un
 * seul codé "pour l'instant", les vrais baux générés par cette app
 * tomberont très probablement après le 1er octobre 2026
 * (docs/data-dictionary.md, section "Édition d'un bail").
 *
 * Pas de section "Clause pénale" distincte, jamais : l'article 4 i) de la
 * loi n° 89-462 interdit purement et simplement toute pénalité
 * contractuelle, sans exception — rien à générer sous cet intitulé
 * (confirmé avec l'utilisateur), fusionné ici sous le seul nom "Clause
 * résolutoire" pour ne jamais laisser croire qu'une pénalité financière
 * existerait légalement.
 */
export function construireSectionVIII(donnees: DonneesSectionVIII): Content {
  const regime = determinerRegimeClauseResolutoire(donnees.dateReference);
  const texte = construireTexteClauseResolutoire(regime, donnees.servitudeResidencePrincipale);

  return [
    { text: "VIII. Clause résolutoire", style: "titreSection" },
    { text: texte, margin: [0, 4, 0, 8] }
  ];
}
