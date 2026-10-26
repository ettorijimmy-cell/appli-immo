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
import {
  CHAMPS_IDENTITE_CLES,
  CHAMPS_IDENTITE_EQUIPEMENTS_DIVERS,
  CLASSIFICATION_CLES,
  CLASSIFICATION_COMPTEURS,
  CLASSIFICATION_EQUIPEMENTS_DIVERS,
  CLASSIFICATION_ETATS_DES_LIEUX,
  CLASSIFICATION_INVENTAIRE,
  CLASSIFICATION_PIECE_AUTRE,
  CLASSIFICATION_PIECE_CHAMBRE,
  CLASSIFICATION_PIECE_CUISINE,
  CLASSIFICATION_PIECE_ENTREE,
  CLASSIFICATION_PIECE_SALLE_DE_BAIN,
  CLASSIFICATION_PIECE_SEJOUR,
  CLASSIFICATION_PIECE_WC,
  type ClassificationChamp
} from "core";
import type { PgTable } from "drizzle-orm/pg-core";

// La classification elle-même (ClassificationChamp et chaque
// CLASSIFICATION_*/CHAMPS_IDENTITE_*) vient de "core" (chantier Signatures,
// revue 2026-10-26) : source UNIQUE partagée avec apps/desktop (affichage
// figé en relecture), réexportée ici à l'identique pour ne rien changer aux
// imports existants de ce module. Seul ce fichier sait associer ces
// enregistrements à une table Drizzle concrète (CLASSIFICATION_PAR_TABLE
// ci-dessous) — un concept Postgres-only que packages/core, agnostique de
// tout ORM, ne peut pas porter.
export type { ClassificationChamp };
export {
  CLASSIFICATION_CLES,
  CLASSIFICATION_COMPTEURS,
  CLASSIFICATION_EQUIPEMENTS_DIVERS,
  CLASSIFICATION_ETATS_DES_LIEUX,
  CLASSIFICATION_INVENTAIRE,
  CLASSIFICATION_PIECE_AUTRE,
  CLASSIFICATION_PIECE_CHAMBRE,
  CLASSIFICATION_PIECE_CUISINE,
  CLASSIFICATION_PIECE_ENTREE,
  CLASSIFICATION_PIECE_SALLE_DE_BAIN,
  CLASSIFICATION_PIECE_SEJOUR,
  CLASSIFICATION_PIECE_WC
};

// Colonnes structurelles/audit, jamais soumises au verrou : ni du contenu
// métier, ni jamais transmises par un submitX()/updateHeader() (gérées par
// mettreAJourAvecAudit ou les clés de jointure elles-mêmes). Reste
// backend-only (contrairement à la classification ci-dessus) : apps/desktop
// ne manipule jamais un dictionnaire générique de colonnes Drizzle, donc
// n'a jamais besoin de cette liste.
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
export const CHAMPS_IDENTITE_PAR_TABLE = new Map<PgTable, ReadonlySet<string>>([
  [etatDesLieuxCles, CHAMPS_IDENTITE_CLES],
  [etatDesLieuxEquipementsDivers, CHAMPS_IDENTITE_EQUIPEMENTS_DIVERS]
]);
