/**
 * Traduit les libellés de `champsManquants` renvoyés par le backend
 * (packages/core/src/baux/valider-completude-generation-bail.ts) en texte
 * lisible pour l'utilisateur + l'écran où renseigner le champ — jamais de
 * nom technique de colonne, jamais de modification du texte métier côté
 * backend (voir ce fichier, qui reste la seule source de vérité des
 * libellés d'origine).
 */

const LIEU_SCI = "Fiche de la SCI, bouton « Modifier »";
const LIEU_BIEN = "Fiche du bien, bouton « Modifier »";
const LIEU_APPARTEMENT = "Fiche de l'appartement, bouton « Modifier »";
const LIEU_LOCATAIRE = "Fiche du locataire, bouton « Modifier »";
// Avertissement explicite : il existe deux formulaires d'ajout de garant,
// seul celui de la fiche locataire collecte ces informations (voir audit
// du 2026-10-12) — l'autre (onglet "Bail actuel") ne les demande pas.
const LIEU_GARANT =
  "Fiche du locataire, section Garants (pas le formulaire d'ajout de garant de l'onglet « Bail actuel », qui ne demande pas ces informations)";
const LIEU_IRL = "Aucune action possible dans l'application — contactez l'administrateur";
const LIEU_TYPE_BIEN = "Aucune action possible : ce document ne s'applique pas à ce type de bien";

export interface AffichageChampManquant {
  libelle: string;
  lieu: string;
}

const CORRESPONDANCES_FIXES: Record<string, AffichageChampManquant> = {
  "Téléphone de la SCI": { libelle: "Téléphone de la SCI", lieu: LIEU_SCI },
  "SCI familiale ou non (détermine la durée légale du bail)": {
    libelle: "SCI : SCI familiale à renseigner",
    lieu: LIEU_SCI
  },
  "Adresse du siège social de la SCI": { libelle: "Adresse du siège social de la SCI", lieu: LIEU_SCI },
  "Code postal du siège social de la SCI": { libelle: "Code postal du siège social de la SCI", lieu: LIEU_SCI },
  "Ville du siège social de la SCI": { libelle: "Ville du siège social de la SCI", lieu: LIEU_SCI },
  "Année de construction de l'immeuble": { libelle: "Année de construction de l'immeuble", lieu: LIEU_BIEN },
  "Type d'habitat de l'immeuble (collectif/individuel)": {
    libelle: "Type d'habitat de l'immeuble (collectif ou individuel)",
    lieu: LIEU_BIEN
  },
  "Régime juridique de l'immeuble (mono-propriété/copropriété)": {
    libelle: "Régime juridique de l'immeuble (monopropriété ou copropriété)",
    lieu: LIEU_BIEN
  },
  "Équipement de la cuisine": { libelle: "Équipement de la cuisine", lieu: LIEU_APPARTEMENT },
  "Dépendances et annexes de l'appartement": {
    libelle: "Dépendances et annexes de l'appartement",
    lieu: LIEU_APPARTEMENT
  },
  "Nombre de pièces principales de l'appartement": {
    libelle: "Nombre de pièces principales de l'appartement",
    lieu: LIEU_APPARTEMENT
  },
  "Mode de chauffage de l'appartement (individuel/collectif)": {
    libelle: "Mode de chauffage de l'appartement",
    lieu: LIEU_APPARTEMENT
  },
  "Mode de production d'eau chaude de l'appartement (individuelle/collective)": {
    libelle: "Mode de production d'eau chaude de l'appartement",
    lieu: LIEU_APPARTEMENT
  },
  "Indice de référence des loyers (IRL) — aucune valeur récente disponible": {
    libelle: "Indice de référence des loyers (IRL) indisponible ou périmé",
    lieu: LIEU_IRL
  },
  "Génération de bail non disponible pour ce type de bien": {
    libelle: "Génération de bail non disponible pour ce type de bien",
    lieu: LIEU_TYPE_BIEN
  }
};

const REGEX_LOCATAIRE = /^(Locataire(?: \d+)?) — (adresse|code postal|ville)$/;
const REGEX_GARANT = /^(Garant(?: \d+)?) — (date de naissance|lieu de naissance|nationalité)$/;

function majusculeInitiale(texte: string): string {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

export function resoudreAffichageChampManquant(champ: string): AffichageChampManquant {
  const correspondance = CORRESPONDANCES_FIXES[champ];
  if (correspondance) {
    return correspondance;
  }

  const matchLocataire = REGEX_LOCATAIRE.exec(champ);
  if (matchLocataire) {
    const [, label, sousChamp] = matchLocataire;
    return { libelle: `${majusculeInitiale(sousChamp!)} du ${label!.toLowerCase()}`, lieu: LIEU_LOCATAIRE };
  }

  const matchGarant = REGEX_GARANT.exec(champ);
  if (matchGarant) {
    const [, label, sousChamp] = matchGarant;
    return { libelle: `${majusculeInitiale(sousChamp!)} du ${label!.toLowerCase()}`, lieu: LIEU_GARANT };
  }

  // Repli défensif : le backend a introduit un nouveau libellé sans mise à
  // jour de cette correspondance — on affiche quand même le texte brut
  // plutôt que de le faire disparaître silencieusement, sans prétendre
  // savoir où le renseigner.
  return { libelle: champ, lieu: "" };
}
