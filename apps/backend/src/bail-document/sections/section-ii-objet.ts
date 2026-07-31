import { determinerRegimeClauseResolutoire, libelleTrancheConstruction } from "core";
import type { Content } from "pdfmake/interfaces";
import type { DonneesSectionII } from "../types";

const LIBELLE_TYPE_HABITAT: Record<string, string> = {
  collectif: "immeuble collectif",
  individuel: "immeuble individuel"
};

const LIBELLE_REGIME_JURIDIQUE: Record<string, string> = {
  mono_propriete: "monopropriété",
  copropriete: "copropriété"
};

const LIBELLE_MODE_PRODUCTION: Record<string, string> = {
  individuel: "individuelle",
  collectif: "collective"
};

/**
 * Section II du contrat-type ("Objet du contrat" / consistance du
 * logement) — champs de "A. Consistance du logement" (décret n°
 * 2015-587), niveau appartement ET immeuble mélangés selon le champ
 * (docs/backlog.md, section "Édition d'un bail" : type_habitat/
 * regime_juridique/annee_construction sont des caractéristiques du
 * bâtiment, le reste du lot).
 */
export function construireSectionII(donnees: DonneesSectionII): Content {
  const { logement } = donnees;

  const localisation = [logement.adresseImmeuble, logement.codePostalImmeuble, logement.villeImmeuble]
    .filter((valeur) => valeur)
    .join(" ");

  const lignes: string[] = [
    `Localisation : ${localisation}, lot n° ${logement.numeroLot}`,
    `Identifiant fiscal du logement : ${logement.identifiantFiscal ?? "[à renseigner]"}`,
    `Type d'habitat : ${logement.typeHabitat ? LIBELLE_TYPE_HABITAT[logement.typeHabitat] : "[à renseigner]"}`,
    `Régime juridique de l'immeuble : ${logement.regimeJuridique ? LIBELLE_REGIME_JURIDIQUE[logement.regimeJuridique] : "[à renseigner]"}`,
    `Période de construction : ${logement.trancheConstruction ? libelleTrancheConstruction(logement.trancheConstruction) : "[à renseigner]"}`,
    `Surface habitable : ${logement.surface ?? "[à renseigner]"} m²`,
    `Nombre de pièces principales : ${logement.nombrePiecesPrincipales ?? "[à renseigner]"}`,
    `Modalité de production de chauffage : ${logement.modeChauffage ? LIBELLE_MODE_PRODUCTION[logement.modeChauffage] : "[à renseigner]"}`,
    `Modalité de production d'eau chaude sanitaire : ${logement.modeEauChaude ? LIBELLE_MODE_PRODUCTION[logement.modeEauChaude] : "[à renseigner]"}`,
    `Niveau de performance du logement (classe DPE) : ${logement.classeDpe ?? "[à renseigner]"}`
  ];

  // Mention "Servitude de résidence principale" (décret n° 2026-596 du 6
  // juillet 2026, section II.B) : n'existe dans le contrat-type qu'à
  // partir du 1er octobre 2026, jamais avant même si applicable — même
  // régime que la clause résolutoire (section VIII).
  const contenu: Content[] = [
    { text: "II. Objet du contrat", style: "titreSection" },
    { text: "A. Consistance du logement", style: "titreSousSection", margin: [0, 4, 0, 2] },
    { ul: lignes, margin: [0, 0, 0, 8] }
  ];

  if (
    donnees.servitudeResidencePrincipale &&
    determinerRegimeClauseResolutoire(donnees.dateReference) === "depuis_2026_10_01"
  ) {
    contenu.push(
      { text: "B. Servitude de résidence principale", style: "titreSousSection", margin: [0, 4, 0, 2] },
      {
        text: "Le logement objet du présent contrat est soumis à l'obligation prévue à l'article L. 151-14-1 du code de l'urbanisme ; il est à usage exclusif de résidence principale, au sens de l'article 2 de la loi n° 89-462 du 6 juillet 1989.",
        margin: [0, 0, 0, 8]
      }
    );
  }

  return contenu;
}
