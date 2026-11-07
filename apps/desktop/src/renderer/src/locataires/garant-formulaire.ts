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
}

export function champsGarantVides(): ChampsGarant {
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
    nationalite: ""
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
    nationalite: garant.nationalite ?? ""
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
    ...(champs.nationalite && { nationalite: champs.nationalite })
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
    nationalite: valeurOuNull(champs.nationalite)
  };
}
