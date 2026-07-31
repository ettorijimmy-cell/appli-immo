import type { Content } from "pdfmake/interfaces";
import type { DonneesSectionI } from "../types";

/**
 * Section I du contrat-type ("Désignation des parties") — décret n°
 * 2015-587, annexe 1/2. Le bailleur est toujours une SCI dans le schéma
 * actuel (`immeubles.sci_id` obligatoire, docs/data-dictionary.md) :
 * jamais de cas "personne physique directe" à gérer ici.
 */
export function construireSectionI(donnees: DonneesSectionI): Content {
  const { bailleur, locataires } = donnees;

  const adresseBailleur = [bailleur.adresse, bailleur.codePostal, bailleur.ville]
    .filter((valeur) => valeur)
    .join(" ");

  const signataire =
    bailleur.nomGerant && bailleur.prenomGerant
      ? ` représentée par son gérant, ${bailleur.prenomGerant} ${bailleur.nomGerant},`
      : "";

  const nomsLocataires = locataires.map((l) => `${l.prenom} ${l.nom}`).join(", ");

  return [
    { text: "I. Désignation des parties", style: "titreSection" },
    {
      text: `Entre les soussignés : ${bailleur.nom}, société civile immobilière,${signataire} dont le siège social est situé ${adresseBailleur}, ci-après dénommée "le bailleur",`,
      margin: [0, 4, 0, 4]
    },
    {
      text: `Et : ${nomsLocataires || "[locataire(s) à renseigner]"}, ci-après dénommé(s) "le locataire",`,
      margin: [0, 0, 0, 8]
    }
  ];
}
