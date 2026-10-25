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
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CLASSIFICATION_PAR_TABLE,
  COLONNES_STRUCTURELLES_IGNOREES,
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
} from "./classification-colonnes-etat-des-lieux";

// Garde-fou anti-régression (demandé explicitement, chantier Signatures) :
// énumère TOUTES les colonnes Drizzle de chaque table du domaine État des
// lieux soumise au verrou, et échoue si l'une d'elles n'est ni ignorée
// (structurelle/audit) ni classée entrée/sortie/commune. Sans ce test, une
// colonne ajoutée plus tard à l'une de ces tables échapperait
// silencieusement au verrou de signature (ni figée à l'entrée, ni à la
// sortie — modifiable pour toujours, y compris après signature).
const TABLES_A_VERIFIER: { nom: string; table: object; classification: Record<string, string> }[] = [
  { nom: "etats_des_lieux", table: etatsDesLieux, classification: CLASSIFICATION_ETATS_DES_LIEUX },
  { nom: "etat_des_lieux_piece_entree", table: etatDesLieuxPieceEntree, classification: CLASSIFICATION_PIECE_ENTREE },
  { nom: "etat_des_lieux_piece_sejour", table: etatDesLieuxPieceSejour, classification: CLASSIFICATION_PIECE_SEJOUR },
  { nom: "etat_des_lieux_piece_cuisine", table: etatDesLieuxPieceCuisine, classification: CLASSIFICATION_PIECE_CUISINE },
  { nom: "etat_des_lieux_pieces_chambre", table: etatDesLieuxPiecesChambre, classification: CLASSIFICATION_PIECE_CHAMBRE },
  {
    nom: "etat_des_lieux_pieces_salle_de_bain",
    table: etatDesLieuxPiecesSalleDeBain,
    classification: CLASSIFICATION_PIECE_SALLE_DE_BAIN
  },
  { nom: "etat_des_lieux_pieces_wc", table: etatDesLieuxPiecesWc, classification: CLASSIFICATION_PIECE_WC },
  { nom: "etat_des_lieux_pieces_autre", table: etatDesLieuxPiecesAutre, classification: CLASSIFICATION_PIECE_AUTRE },
  { nom: "etat_des_lieux_compteurs", table: etatDesLieuxCompteurs, classification: CLASSIFICATION_COMPTEURS },
  { nom: "etat_des_lieux_cles", table: etatDesLieuxCles, classification: CLASSIFICATION_CLES },
  {
    nom: "etat_des_lieux_equipements_divers",
    table: etatDesLieuxEquipementsDivers,
    classification: CLASSIFICATION_EQUIPEMENTS_DIVERS
  },
  { nom: "etat_des_lieux_inventaire", table: etatDesLieuxInventaire, classification: CLASSIFICATION_INVENTAIRE }
];

describe("Classification des colonnes du domaine État des lieux — exhaustivité", () => {
  it.each(TABLES_A_VERIFIER)("$nom : chaque colonne est ignorée ou classée", ({ table, classification }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- getTableColumns attend un PgTable concret, cette liste mélange volontairement toutes les tables du domaine
    const colonnes = Object.keys(getTableColumns(table as any));
    expect(colonnes.length).toBeGreaterThan(0);

    const nonClassees = colonnes.filter(
      (colonne) => !COLONNES_STRUCTURELLES_IGNOREES.has(colonne) && !(colonne in classification)
    );
    expect(nonClassees).toEqual([]);
  });

  it("couvre exactement les tables testées ci-dessus, et aucune autre (CLASSIFICATION_PAR_TABLE)", () => {
    expect(CLASSIFICATION_PAR_TABLE.size).toBe(TABLES_A_VERIFIER.length);
  });

  it("aucune entrée de classification ne porte un nom de colonne structurelle/ignorée", () => {
    for (const { classification } of TABLES_A_VERIFIER) {
      for (const colonne of Object.keys(classification)) {
        expect(COLONNES_STRUCTURELLES_IGNOREES.has(colonne)).toBe(false);
      }
    }
  });
});
