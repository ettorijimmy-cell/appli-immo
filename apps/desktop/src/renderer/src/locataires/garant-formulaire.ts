import { situationLocataireCautionne } from "core";
import { valeurOuNull } from "../lib/valeur-ou-null";
import type { CreateGarantInput, Garant, GarantTypeGarantie, UpdateGarantInput } from "./api";

export const GARANT_TYPES: GarantTypeGarantie[] = ["personne_physique", "garantie_visale", "autre"];

// Valeurs saisies dans les formulaires garant (chaînes brutes des champs,
// "" pour un champ vide). Partagé par NewGarantForm et EditGarantForm
// (GarantForms.tsx), utilisés depuis la fiche locataire et l'onglet
// « Bail actuel ».
export interface ChampsGarant {
  nom: string;
  prenom: string;
  email: string;
  telephone: string;
  typeGarantie: GarantTypeGarantie;
  adresse: string;
  codePostal: string;
  ville: string;
  dateNaissance: string;
  lieuNaissance: string;
  nationalite: string;
  // Locataire du bail dont le garant se porte caution ("" = non précisé).
  locataireId: string;
}

export function champsGarantVides(locataireIdParDefaut = ""): ChampsGarant {
  return {
    nom: "",
    prenom: "",
    email: "",
    telephone: "",
    typeGarantie: "personne_physique",
    adresse: "",
    codePostal: "",
    ville: "",
    dateNaissance: "",
    lieuNaissance: "",
    nationalite: "",
    locataireId: locataireIdParDefaut
  };
}

export function champsGarantDepuis(garant: Garant): ChampsGarant {
  return {
    nom: garant.nom,
    prenom: garant.prenom,
    email: garant.email ?? "",
    telephone: garant.telephone ?? "",
    typeGarantie: garant.typeGarantie,
    adresse: garant.adresse ?? "",
    codePostal: garant.codePostal ?? "",
    ville: garant.ville ?? "",
    dateNaissance: garant.dateNaissance ?? "",
    lieuNaissance: garant.lieuNaissance ?? "",
    nationalite: garant.nationalite ?? "",
    locataireId: garant.locataireId ?? ""
  };
}

// Création : un champ facultatif vide est omis (rien à effacer).
export function creationGarant(bailId: string, champs: ChampsGarant): CreateGarantInput {
  return {
    bailId,
    nom: champs.nom,
    prenom: champs.prenom,
    typeGarantie: champs.typeGarantie,
    ...(champs.email && { email: champs.email }),
    ...(champs.telephone && { telephone: champs.telephone }),
    ...(champs.adresse && { adresse: champs.adresse }),
    ...(champs.codePostal && { codePostal: champs.codePostal }),
    ...(champs.ville && { ville: champs.ville }),
    ...(champs.dateNaissance && { dateNaissance: champs.dateNaissance }),
    ...(champs.lieuNaissance && { lieuNaissance: champs.lieuNaissance }),
    ...(champs.nationalite && { nationalite: champs.nationalite }),
    ...(champs.locataireId && { locataireId: champs.locataireId })
  };
}

// Modification : un champ facultatif vidé est envoyé en `null` explicite
// pour l'effacer en base (voir UpdateGarantInput, valeurOuNull).
export function modificationGarant(champs: ChampsGarant): UpdateGarantInput {
  return {
    nom: champs.nom,
    prenom: champs.prenom,
    typeGarantie: champs.typeGarantie,
    email: valeurOuNull(champs.email),
    telephone: valeurOuNull(champs.telephone),
    adresse: valeurOuNull(champs.adresse),
    codePostal: valeurOuNull(champs.codePostal),
    ville: valeurOuNull(champs.ville),
    dateNaissance: valeurOuNull(champs.dateNaissance),
    lieuNaissance: valeurOuNull(champs.lieuNaissance),
    nationalite: valeurOuNull(champs.nationalite),
    locataireId: valeurOuNull(champs.locataireId)
  };
}

// Locataire proposé dans le champ « Caution de » : un locataire rattaché
// au bail (lien non archivé).
export interface LocataireDuBail {
  id: string;
  prenom: string;
  nom: string;
}

export interface OptionCautionDe {
  valeur: string;
  libelle: string;
}

export const LIBELLE_NON_PRECISE = "Non précisé";
export const MENTION_PLUS_AU_BAIL = "(n'est plus au bail)";

// Options du champ « Caution de » : « Non précisé », puis les locataires
// du bail. Si la valeur déjà enregistrée désigne un locataire qui a quitté
// le bail, elle reste proposée (et sélectionnée) avec la mention « (n'est
// plus au bail) », pour qu'un enregistrement sans changement ne la perde
// pas — le backend l'accepte telle quelle (GarantsService.update).
export function optionsCautionDe(
  locatairesDuBail: readonly LocataireDuBail[],
  valeurEnregistree: string,
  nomsLocataires: ReadonlyMap<string, string>
): OptionCautionDe[] {
  const options: OptionCautionDe[] = [
    { valeur: "", libelle: LIBELLE_NON_PRECISE },
    ...locatairesDuBail.map((l) => ({ valeur: l.id, libelle: `${l.prenom} ${l.nom}` }))
  ];
  if (valeurEnregistree && !locatairesDuBail.some((l) => l.id === valeurEnregistree)) {
    const nom = nomsLocataires.get(valeurEnregistree) ?? "Locataire";
    options.push({ valeur: valeurEnregistree, libelle: `${nom} ${MENTION_PLUS_AU_BAIL}` });
  }
  return options;
}

// Mention affichée dans la liste des garants : « caution de Marie Dupont »,
// suivie de « (n'est plus au bail) » si ce locataire a été retiré du bail ;
// null si le garant n'est rattaché à personne (non précisé).
export function mentionCautionDe(
  locataireId: string | null,
  locataireIdsAuBail: readonly string[],
  nomsLocataires: ReadonlyMap<string, string>
): string | null {
  const situation = situationLocataireCautionne(locataireId, locataireIdsAuBail);
  if (situation === "non_precise" || locataireId === null) {
    return null;
  }
  const mention = `caution de ${nomsLocataires.get(locataireId) ?? "locataire inconnu"}`;
  return situation === "plus_au_bail" ? `${mention} ${MENTION_PLUS_AU_BAIL}` : mention;
}
