/**
 * Vérifie que les données nécessaires à la génération du document de bail
 * sont bien renseignées, AVANT de générer quoi que ce soit — jamais un
 * champ absent inséré silencieusement dans un document légal réel
 * (docs/data-dictionary.md, section "scis" / confirmé pour est_familiale).
 *
 * Couvre les champs explicitement désignés comme bloquants :
 * `scis.est_familiale` (détermine la durée légale du bail vide),
 * `scis.telephone`, `scis.adresse`/`code_postal`/`ville` (siège social),
 * `immeubles.annee_construction` (aucune tranche de construction affichable
 * sans elle), `immeubles.type_habitat`/`regime_juridique`,
 * `appartements.equipement_cuisine`/`dependances_annexes`,
 * `appartements.nombre_pieces_principales`/`mode_chauffage`/
 * `mode_eau_chaude`, l'adresse de chaque locataire du bail, et l'identité
 * de chaque garant éventuellement rattaché (date/lieu de naissance,
 * nationalité).
 *
 * Un bail SANS garant reste valide — "Aucun garant" est un état légitime,
 * jamais traité comme une donnée manquante. `garants` est un tableau
 * potentiellement vide plutôt qu'optionnel : l'appelant doit toujours
 * savoir explicitement s'il y a des garants ou non, pas l'omettre par
 * oubli (docs/data-dictionary.md, section "Édition d'un bail").
 *
 * `irlIndisponible` : calculé par l'appelant (aucune ligne en base, ou
 * `irlEstPerime` vrai sur la plus récente) — jamais un texte à compléter
 * inséré dans le document, la génération bloque comme pour tout autre
 * champ manquant.
 */

export interface DonneesCompletudeSci {
  telephone: string | null;
  estFamiliale: boolean | null;
  adresse: string | null;
  codePostal: string | null;
  ville: string | null;
}

export interface DonneesCompletudeImmeuble {
  anneeConstruction: number | null;
  typeHabitat: string | null;
  regimeJuridique: string | null;
}

export interface DonneesCompletudeAppartement {
  equipementCuisine: string | null;
  dependancesAnnexes: string | null;
  nombrePiecesPrincipales: number | null;
  modeChauffage: string | null;
  modeEauChaude: string | null;
}

export interface DonneesCompletudeLocataire {
  adresse: string | null;
  codePostal: string | null;
  ville: string | null;
}

export interface DonneesCompletudeGarant {
  dateNaissance: string | null;
  lieuNaissance: string | null;
  nationalite: string | null;
}

export interface DonneesCompletudeGenerationBail {
  sci: DonneesCompletudeSci;
  immeuble: DonneesCompletudeImmeuble;
  appartement: DonneesCompletudeAppartement;
  locataires: DonneesCompletudeLocataire[];
  garants: DonneesCompletudeGarant[];
  irlIndisponible: boolean;
}

export function validerCompletudeGenerationBail(donnees: DonneesCompletudeGenerationBail): string[] {
  const manquants: string[] = [];

  if (donnees.sci.telephone === null) {
    manquants.push("Téléphone de la SCI");
  }
  if (donnees.sci.estFamiliale === null) {
    manquants.push("SCI familiale ou non (détermine la durée légale du bail)");
  }
  if (donnees.sci.adresse === null) {
    manquants.push("Adresse du siège social de la SCI");
  }
  if (donnees.sci.codePostal === null) {
    manquants.push("Code postal du siège social de la SCI");
  }
  if (donnees.sci.ville === null) {
    manquants.push("Ville du siège social de la SCI");
  }
  if (donnees.immeuble.anneeConstruction === null) {
    manquants.push("Année de construction de l'immeuble");
  }
  if (donnees.immeuble.typeHabitat === null) {
    manquants.push("Type d'habitat de l'immeuble (collectif/individuel)");
  }
  if (donnees.immeuble.regimeJuridique === null) {
    manquants.push("Régime juridique de l'immeuble (mono-propriété/copropriété)");
  }
  if (donnees.appartement.equipementCuisine === null) {
    manquants.push("Équipement de la cuisine");
  }
  if (donnees.appartement.dependancesAnnexes === null) {
    manquants.push("Dépendances et annexes de l'appartement");
  }
  if (donnees.appartement.nombrePiecesPrincipales === null) {
    manquants.push("Nombre de pièces principales de l'appartement");
  }
  if (donnees.appartement.modeChauffage === null) {
    manquants.push("Mode de chauffage de l'appartement (individuel/collectif)");
  }
  if (donnees.appartement.modeEauChaude === null) {
    manquants.push("Mode de production d'eau chaude de l'appartement (individuelle/collective)");
  }
  if (donnees.irlIndisponible) {
    manquants.push("Indice de référence des loyers (IRL) — aucune valeur récente disponible");
  }

  donnees.locataires.forEach((locataire, index) => {
    const label = donnees.locataires.length > 1 ? `Locataire ${index + 1}` : "Locataire";
    if (locataire.adresse === null) {
      manquants.push(`${label} — adresse`);
    }
    if (locataire.codePostal === null) {
      manquants.push(`${label} — code postal`);
    }
    if (locataire.ville === null) {
      manquants.push(`${label} — ville`);
    }
  });

  // Un bail sans garant reste valide — la boucle ne s'exécute simplement
  // pas si `garants` est vide, aucune vérification n'est alors faite.
  donnees.garants.forEach((garant, index) => {
    const label = donnees.garants.length > 1 ? `Garant ${index + 1}` : "Garant";
    if (garant.dateNaissance === null) {
      manquants.push(`${label} — date de naissance`);
    }
    if (garant.lieuNaissance === null) {
      manquants.push(`${label} — lieu de naissance`);
    }
    if (garant.nationalite === null) {
      manquants.push(`${label} — nationalité`);
    }
  });

  return manquants;
}
