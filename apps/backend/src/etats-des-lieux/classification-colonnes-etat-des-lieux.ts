import {
  etatDesLieuxCles,
  etatDesLieuxCompteurs,
  etatDesLieuxEquipementsDivers,
  etatDesLieuxInventaire,
  etatDesLieuxPieceCuisine,
  etatDesLieuxPieceEntree,
  etatDesLieuxPieceSejour,
  etatDesLieuxPiecesAutre,
  etatDesLieuxPiecesChambre,
  etatDesLieuxPiecesSalleDeBain,
  etatDesLieuxPiecesWc,
  etatsDesLieux
} from "db";
import type { PgTable } from "drizzle-orm/pg-core";

// Classification de chaque champ métier du domaine État des lieux, utilisée
// par le verrou de signature (verrou-champs-etat-des-lieux.ts) pour décider
// ce qui reste modifiable selon les phases déjà signées :
// - "entree" : figé dès la signature de l'entrée
// - "sortie" : figé seulement à la signature de la sortie
// - "commune" : un champ sans notion d'entrée/sortie propre (description,
//   libellé, commentaire...) — figé dès la signature de l'ENTRÉE, pas
//   seulement à la sortie (décision explicite : ces champs décrivent le
//   logement tel que constaté à l'entrée, ne doivent plus bouger une fois
//   celle-ci actée, même si la sortie reste loin dans le temps).
export type ClassificationChamp = "entree" | "sortie" | "commune";

// Colonnes structurelles/audit, jamais soumises au verrou : ni du contenu
// métier, ni jamais transmises par un submitX()/updateHeader() (gérées par
// mettreAJourAvecAudit ou les clés de jointure elles-mêmes).
export const COLONNES_STRUCTURELLES_IGNOREES = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "updatedBy",
  "version",
  "archivedAt",
  "etatDesLieuxId",
  "numero",
  "elementId",
  "bailId"
]);

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
// plafond/eclairage/prises + prisesNombre, voir
// EtatsDesLieuxService.aplatirSocle).
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
  // Comptage physique, pas un état (docs/data-dictionary.md) — pas de
  // suffixe Entrée/Sortie, donc commune.
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
  // Texte libre sans échelle d'état (docs/data-dictionary.md) — commune.
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

// Registre central table Drizzle -> classification de ses colonnes. Chaque
// table ici est aussi couverte par le test d'exhaustivité
// (classification-colonnes-etat-des-lieux.spec.ts) : toute colonne absente
// à la fois de COLONNES_STRUCTURELLES_IGNOREES et de la classification de
// sa table fait échouer ce test, pour qu'une colonne ajoutée plus tard ne
// puisse jamais échapper silencieusement au verrou.
//
// etat_des_lieux_signature est volontairement ABSENTE de ce registre : ce
// n'est pas une table de contenu soumise au verrou, c'est le verrou
// lui-même (l'existence de ses lignes EST ce qui déclenche le gel des
// autres tables) — lui appliquer "entree/sortie/commune" n'aurait pas de
// sens.
export const CLASSIFICATION_PAR_TABLE = new Map<PgTable, Record<string, ClassificationChamp>>([
  [etatsDesLieux, CLASSIFICATION_ETATS_DES_LIEUX],
  [etatDesLieuxPieceEntree, CLASSIFICATION_PIECE_ENTREE],
  [etatDesLieuxPieceSejour, CLASSIFICATION_PIECE_SEJOUR],
  [etatDesLieuxPieceCuisine, CLASSIFICATION_PIECE_CUISINE],
  [etatDesLieuxPiecesChambre, CLASSIFICATION_PIECE_CHAMBRE],
  [etatDesLieuxPiecesSalleDeBain, CLASSIFICATION_PIECE_SALLE_DE_BAIN],
  [etatDesLieuxPiecesWc, CLASSIFICATION_PIECE_WC],
  [etatDesLieuxPiecesAutre, CLASSIFICATION_PIECE_AUTRE],
  [etatDesLieuxCompteurs, CLASSIFICATION_COMPTEURS],
  [etatDesLieuxCles, CLASSIFICATION_CLES],
  [etatDesLieuxEquipementsDivers, CLASSIFICATION_EQUIPEMENTS_DIVERS],
  [etatDesLieuxInventaire, CLASSIFICATION_INVENTAIRE]
]);

// Champs d'IDENTITÉ (revue 2026-10-25) : sous-ensemble des champs
// "commune" d'une table qui désignent QUEL élément une ligne représente,
// plutôt qu'un fait constaté sur cet élément. Utilisé uniquement par
// verrou-champs-etat-des-lieux.ts pour autoriser une ligne NEUVE après la
// signature d'entrée (mais avant celle de sortie) à condition qu'elle ne
// renseigne QUE son identité et des champs "sortie" — jamais un champ
// "entree", ni un autre champ "commune" (ex. commentaire). Représente un
// élément absent à l'entrée et découvert avant la sortie (ex. une clé
// remise en cours de bail). `etat_des_lieux_inventaire` n'y figure pas :
// son identité (elementId) est une colonne structurelle, jamais une clé
// de `champs` (voir upsertEtArchiverParElementId).
export const CHAMPS_IDENTITE_PAR_TABLE = new Map<PgTable, Set<string>>([
  [etatDesLieuxCles, new Set(["typeCle", "libelleAutre"])],
  [etatDesLieuxEquipementsDivers, new Set(["libelle"])]
]);
