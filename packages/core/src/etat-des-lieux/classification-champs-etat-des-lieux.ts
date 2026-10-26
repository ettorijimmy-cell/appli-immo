// Classification de chaque champ métier du domaine État des lieux, utilisée
// par le verrou de signature pour décider ce qui reste modifiable selon les
// phases déjà signées :
// - "entree" : figé dès la signature de l'entrée
// - "sortie" : figé seulement à la signature de la sortie
// - "commune" : un champ sans notion d'entrée/sortie propre (description,
//   libellé, commentaire...) — figé dès la signature de l'ENTRÉE, pas
//   seulement à la sortie (décision explicite : ces champs décrivent le
//   logement tel que constaté à l'entrée, ne doivent plus bouger une fois
//   celle-ci actée, même si la sortie reste loin dans le temps).
//
// Source UNIQUE de cette classification (chantier Signatures, revue
// 2026-10-26) : apps/backend (verrou d'écriture, verrou-champs-etat-des-
// lieux.ts) et apps/desktop (affichage figé en relecture) l'importent tous
// les deux d'ici plutôt que de la recopier à la main — toute colonne
// reclassée ne l'est donc qu'en un seul endroit. apps/backend reste seul à
// savoir associer ces enregistrements à une table Drizzle concrète
// (classification-colonnes-etat-des-lieux.ts, PgTable Postgres-only).
export type ClassificationChamp = "entree" | "sortie" | "commune";

export const CLASSIFICATION_ETATS_DES_LIEUX: Record<string, ClassificationChamp> = {
  dateEntree: "entree",
  lieuEntree: "entree",
  dateSortie: "sortie",
  lieuSortie: "sortie",
  // Exception à la règle "sans suffixe Entrée/Sortie => commune" : ce champ
  // n'a de sens qu'à la sortie (décret n° 2016-382, art. 2, 2° a), jamais à
  // l'entrée — il doit donc rester modifiable jusqu'à la signature de
  // sortie, pas se figer dès l'entrée comme un champ "commune" ordinaire.
  nouvelleAdresseLocataire: "sortie"
};

// Socle commun à toutes les tables de pièce (mur/sol/vitrageVolets/
// plafond/eclairage/prises + prisesNombre).
const SOCLE_PIECE: Record<string, ClassificationChamp> = {
  murDescription: "commune",
  murEtatEntree: "entree",
  murEtatSortie: "sortie",
  solDescription: "commune",
  solEtatEntree: "entree",
  solEtatSortie: "sortie",
  vitrageVoletsDescription: "commune",
  vitrageVoletsEtatEntree: "entree",
  vitrageVoletsEtatSortie: "sortie",
  plafondDescription: "commune",
  plafondEtatEntree: "entree",
  plafondEtatSortie: "sortie",
  eclairageDescription: "commune",
  eclairageEtatEntree: "entree",
  eclairageEtatSortie: "sortie",
  prisesDescription: "commune",
  prisesEtatEntree: "entree",
  prisesEtatSortie: "sortie",
  // Comptage physique, pas un état — pas de suffixe Entrée/Sortie, donc
  // commune.
  prisesNombre: "commune"
};

export const CLASSIFICATION_PIECE_ENTREE: Record<string, ClassificationChamp> = {
  ...SOCLE_PIECE,
  porteDescription: "commune",
  porteEtatEntree: "entree",
  porteEtatSortie: "sortie",
  sonnetteDescription: "commune",
  sonnetteEtatEntree: "entree",
  sonnetteEtatSortie: "sortie"
};

export const CLASSIFICATION_PIECE_SEJOUR: Record<string, ClassificationChamp> = { ...SOCLE_PIECE };

export const CLASSIFICATION_PIECE_CUISINE: Record<string, ClassificationChamp> = {
  ...SOCLE_PIECE,
  placardsDescription: "commune",
  placardsEtatEntree: "entree",
  placardsEtatSortie: "sortie",
  evierDescription: "commune",
  evierEtatEntree: "entree",
  evierEtatSortie: "sortie",
  plaquesCuissonDescription: "commune",
  plaquesCuissonEtatEntree: "entree",
  plaquesCuissonEtatSortie: "sortie",
  hotteDescription: "commune",
  hotteEtatEntree: "entree",
  hotteEtatSortie: "sortie",
  // Texte libre sans échelle d'état — commune.
  electromenagerDescription: "commune"
};

// Chambres : même socle, rien de spécifique (numero est structurel).
export const CLASSIFICATION_PIECE_CHAMBRE: Record<string, ClassificationChamp> = { ...SOCLE_PIECE };

export const CLASSIFICATION_PIECE_SALLE_DE_BAIN: Record<string, ClassificationChamp> = {
  ...SOCLE_PIECE,
  lavaboDescription: "commune",
  lavaboEtatEntree: "entree",
  lavaboEtatSortie: "sortie",
  baignoireDescription: "commune",
  baignoireEtatEntree: "entree",
  baignoireEtatSortie: "sortie"
};

export const CLASSIFICATION_PIECE_WC: Record<string, ClassificationChamp> = {
  ...SOCLE_PIECE,
  lavaboDescription: "commune",
  lavaboEtatEntree: "entree",
  lavaboEtatSortie: "sortie",
  wcDescription: "commune",
  wcEtatEntree: "entree",
  wcEtatSortie: "sortie"
};

export const CLASSIFICATION_PIECE_AUTRE: Record<string, ClassificationChamp> = {
  ...SOCLE_PIECE,
  // Libellé de la pièce elle-même ("Chambre 4"...) — commune.
  libelle: "commune"
};

export const CLASSIFICATION_COMPTEURS: Record<string, ClassificationChamp> = {
  electriciteNumeroCompteurEntree: "entree",
  electriciteNumeroCompteurSortie: "sortie",
  electriciteReleveHpEntree: "entree",
  electriciteReleveHpSortie: "sortie",
  electriciteReleveHcEntree: "entree",
  electriciteReleveHcSortie: "sortie",
  electriciteAncienOccupantEntree: "entree",
  electriciteAncienOccupantSortie: "sortie",
  gazNumeroCompteurEntree: "entree",
  gazNumeroCompteurSortie: "sortie",
  gazReleveEntree: "entree",
  gazReleveSortie: "sortie",
  eauReleveFroideEntree: "entree",
  eauReleveFroideSortie: "sortie",
  eauReleveChaudeEntree: "entree",
  eauReleveChaudeSortie: "sortie"
};

export const CLASSIFICATION_CLES: Record<string, ClassificationChamp> = {
  // Quel type de clé existe — constaté à l'entrée, commune.
  typeCle: "commune",
  libelleAutre: "commune",
  nombreEntree: "entree",
  nombreSortie: "sortie",
  commentaire: "commune"
};

export const CLASSIFICATION_EQUIPEMENTS_DIVERS: Record<string, ClassificationChamp> = {
  libelle: "commune",
  nombreEntree: "entree",
  etatEntree: "entree",
  nombreSortie: "sortie",
  etatSortie: "sortie",
  commentaire: "commune"
};

export const CLASSIFICATION_INVENTAIRE: Record<string, ClassificationChamp> = {
  nombreEntree: "entree",
  etatEntree: "entree",
  nombreSortie: "sortie",
  etatSortie: "sortie",
  commentaire: "commune"
};

// Champs d'IDENTITÉ : sous-ensemble des champs "commune" d'une table qui
// désignent QUEL élément une ligne représente, plutôt qu'un fait constaté
// sur cet élément. Une ligne NEUVE après la signature d'entrée (mais avant
// celle de sortie) peut renseigner UNIQUEMENT son identité et des champs
// "sortie" (ex. une clé remise en cours de bail) — jamais un champ
// "entree", ni un autre champ "commune" (ex. commentaire).
// `etat_des_lieux_inventaire` n'y figure pas : son identité (elementId) est
// une colonne structurelle, jamais une clé de `champs`.
export const CHAMPS_IDENTITE_CLES: ReadonlySet<string> = new Set(["typeCle", "libelleAutre"]);
export const CHAMPS_IDENTITE_EQUIPEMENTS_DIVERS: ReadonlySet<string> = new Set(["libelle"]);

/**
 * Un champ existant est figé dès que sa phase de signature est passée —
 * même formule que le verrou d'écriture backend (verifierChampsAutorises) :
 * figé si la sortie est signée, ou si l'entrée l'est et que le champ n'est
 * pas lui-même un champ "sortie".
 */
export function champFigeParSignature(
  categorie: ClassificationChamp,
  entreeSignee: boolean,
  sortieSignee: boolean
): boolean {
  return sortieSignee || (entreeSignee && categorie !== "sortie");
}

/**
 * Un champ est modifiable si : la sortie n'est pas signée, ET (soit
 * l'entrée n'est pas encore signée, soit c'est un champ "sortie", soit —
 * seulement sur une ligne NEUVE, sans id — c'est un champ d'identité).
 */
export function champModifiable(params: {
  nomChamp: string;
  classification: Record<string, ClassificationChamp>;
  champsIdentite?: ReadonlySet<string>;
  ligneExistante: boolean;
  entreeSignee: boolean;
  sortieSignee: boolean;
}): boolean {
  const { nomChamp, classification, champsIdentite, ligneExistante, entreeSignee, sortieSignee } = params;
  if (sortieSignee) {
    return false;
  }
  if (!entreeSignee) {
    return true;
  }
  const categorie = classification[nomChamp];
  if (categorie === "sortie") {
    return true;
  }
  return !ligneExistante && (champsIdentite?.has(nomChamp) ?? false);
}
