import { integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { etatDesLieuxElementEtatEnum, etatsDesLieux } from "./etats-des-lieux";

/**
 * Modélisation littérale (Option B, validée avec le propriétaire) : une
 * table par groupe de pièce du modèle Word réel (tmp/Modèle état des
 * lieux.docx), pas de catalogue de types de pièces/éléments en base — le
 * décret n° 2016-382 et le modèle du propriétaire sont fixes, la
 * flexibilité d'un catalogue ne serait jamais exploitée.
 *
 * Chaque élément porte trois colonnes (description, état entrée, état
 * sortie) — "Description / détails" est une colonne à part entière du
 * modèle réel, distincte de la lettre M/P/B/TB. "Vitrage et volets" est
 * uniforme sur toutes les pièces (le séjour, seul cas différent dans le
 * modèle initial du propriétaire — juste "Vitrage" — a été corrigé par
 * lui pour s'aligner sur les autres pièces).
 *
 * Chambres/Salles de bain/WC/Autres pièces : une ligne par instance
 * réelle (numero 1, 2, 3...), pas des colonnes répétées — contrainte
 * d'unicité (etat_des_lieux_id, numero) pour empêcher un doublon.
 */

export const etatDesLieuxPieceEntree = pgTable("etat_des_lieux_piece_entree", {
  ...auditColumns,
  etatDesLieuxId: uuid("etat_des_lieux_id")
    .notNull()
    .unique()
    .references(() => etatsDesLieux.id),
  porteDescription: text("porte_description"),
  porteEtatEntree: etatDesLieuxElementEtatEnum("porte_etat_entree"),
  porteEtatSortie: etatDesLieuxElementEtatEnum("porte_etat_sortie"),
  sonnetteDescription: text("sonnette_description"),
  sonnetteEtatEntree: etatDesLieuxElementEtatEnum("sonnette_etat_entree"),
  sonnetteEtatSortie: etatDesLieuxElementEtatEnum("sonnette_etat_sortie"),
  murDescription: text("mur_description"),
  murEtatEntree: etatDesLieuxElementEtatEnum("mur_etat_entree"),
  murEtatSortie: etatDesLieuxElementEtatEnum("mur_etat_sortie"),
  solDescription: text("sol_description"),
  solEtatEntree: etatDesLieuxElementEtatEnum("sol_etat_entree"),
  solEtatSortie: etatDesLieuxElementEtatEnum("sol_etat_sortie"),
  vitrageVoletsDescription: text("vitrage_volets_description"),
  vitrageVoletsEtatEntree: etatDesLieuxElementEtatEnum("vitrage_volets_etat_entree"),
  vitrageVoletsEtatSortie: etatDesLieuxElementEtatEnum("vitrage_volets_etat_sortie"),
  plafondDescription: text("plafond_description"),
  plafondEtatEntree: etatDesLieuxElementEtatEnum("plafond_etat_entree"),
  plafondEtatSortie: etatDesLieuxElementEtatEnum("plafond_etat_sortie"),
  eclairageDescription: text("eclairage_description"),
  eclairageEtatEntree: etatDesLieuxElementEtatEnum("eclairage_etat_entree"),
  eclairageEtatSortie: etatDesLieuxElementEtatEnum("eclairage_etat_sortie"),
  prisesDescription: text("prises_description"),
  prisesEtatEntree: etatDesLieuxElementEtatEnum("prises_etat_entree"),
  prisesEtatSortie: etatDesLieuxElementEtatEnum("prises_etat_sortie"),
  prisesNombre: integer("prises_nombre")
});

export const etatDesLieuxPieceSejour = pgTable("etat_des_lieux_piece_sejour", {
  ...auditColumns,
  etatDesLieuxId: uuid("etat_des_lieux_id")
    .notNull()
    .unique()
    .references(() => etatsDesLieux.id),
  murDescription: text("mur_description"),
  murEtatEntree: etatDesLieuxElementEtatEnum("mur_etat_entree"),
  murEtatSortie: etatDesLieuxElementEtatEnum("mur_etat_sortie"),
  solDescription: text("sol_description"),
  solEtatEntree: etatDesLieuxElementEtatEnum("sol_etat_entree"),
  solEtatSortie: etatDesLieuxElementEtatEnum("sol_etat_sortie"),
  vitrageVoletsDescription: text("vitrage_volets_description"),
  vitrageVoletsEtatEntree: etatDesLieuxElementEtatEnum("vitrage_volets_etat_entree"),
  vitrageVoletsEtatSortie: etatDesLieuxElementEtatEnum("vitrage_volets_etat_sortie"),
  plafondDescription: text("plafond_description"),
  plafondEtatEntree: etatDesLieuxElementEtatEnum("plafond_etat_entree"),
  plafondEtatSortie: etatDesLieuxElementEtatEnum("plafond_etat_sortie"),
  eclairageDescription: text("eclairage_description"),
  eclairageEtatEntree: etatDesLieuxElementEtatEnum("eclairage_etat_entree"),
  eclairageEtatSortie: etatDesLieuxElementEtatEnum("eclairage_etat_sortie"),
  prisesDescription: text("prises_description"),
  prisesEtatEntree: etatDesLieuxElementEtatEnum("prises_etat_entree"),
  prisesEtatSortie: etatDesLieuxElementEtatEnum("prises_etat_sortie"),
  prisesNombre: integer("prises_nombre")
});

export const etatDesLieuxPieceCuisine = pgTable("etat_des_lieux_piece_cuisine", {
  ...auditColumns,
  etatDesLieuxId: uuid("etat_des_lieux_id")
    .notNull()
    .unique()
    .references(() => etatsDesLieux.id),
  murDescription: text("mur_description"),
  murEtatEntree: etatDesLieuxElementEtatEnum("mur_etat_entree"),
  murEtatSortie: etatDesLieuxElementEtatEnum("mur_etat_sortie"),
  solDescription: text("sol_description"),
  solEtatEntree: etatDesLieuxElementEtatEnum("sol_etat_entree"),
  solEtatSortie: etatDesLieuxElementEtatEnum("sol_etat_sortie"),
  vitrageVoletsDescription: text("vitrage_volets_description"),
  vitrageVoletsEtatEntree: etatDesLieuxElementEtatEnum("vitrage_volets_etat_entree"),
  vitrageVoletsEtatSortie: etatDesLieuxElementEtatEnum("vitrage_volets_etat_sortie"),
  plafondDescription: text("plafond_description"),
  plafondEtatEntree: etatDesLieuxElementEtatEnum("plafond_etat_entree"),
  plafondEtatSortie: etatDesLieuxElementEtatEnum("plafond_etat_sortie"),
  eclairageDescription: text("eclairage_description"),
  eclairageEtatEntree: etatDesLieuxElementEtatEnum("eclairage_etat_entree"),
  eclairageEtatSortie: etatDesLieuxElementEtatEnum("eclairage_etat_sortie"),
  prisesDescription: text("prises_description"),
  prisesEtatEntree: etatDesLieuxElementEtatEnum("prises_etat_entree"),
  prisesEtatSortie: etatDesLieuxElementEtatEnum("prises_etat_sortie"),
  prisesNombre: integer("prises_nombre"),
  placardsDescription: text("placards_description"),
  placardsEtatEntree: etatDesLieuxElementEtatEnum("placards_etat_entree"),
  placardsEtatSortie: etatDesLieuxElementEtatEnum("placards_etat_sortie"),
  evierDescription: text("evier_description"),
  evierEtatEntree: etatDesLieuxElementEtatEnum("evier_etat_entree"),
  evierEtatSortie: etatDesLieuxElementEtatEnum("evier_etat_sortie"),
  plaquesCuissonDescription: text("plaques_cuisson_description"),
  plaquesCuissonEtatEntree: etatDesLieuxElementEtatEnum("plaques_cuisson_etat_entree"),
  plaquesCuissonEtatSortie: etatDesLieuxElementEtatEnum("plaques_cuisson_etat_sortie"),
  hotteDescription: text("hotte_description"),
  hotteEtatEntree: etatDesLieuxElementEtatEnum("hotte_etat_entree"),
  hotteEtatSortie: etatDesLieuxElementEtatEnum("hotte_etat_sortie"),
  // Ligne libre du modèle réel ("Électroménager : ……"), sans échelle
  // d'état — distincte de l'inventaire meublé (four/plaques encastrés
  // existent même en bail vide, décision assumée avec le propriétaire).
  electromenagerDescription: text("electromenager_description")
});

export const etatDesLieuxPiecesChambre = pgTable(
  "etat_des_lieux_pieces_chambre",
  {
    ...auditColumns,
    etatDesLieuxId: uuid("etat_des_lieux_id")
      .notNull()
      .references(() => etatsDesLieux.id),
    // 1 à 3 (jusqu'à 3 chambres dans le modèle réel).
    numero: integer("numero").notNull(),
    murDescription: text("mur_description"),
    murEtatEntree: etatDesLieuxElementEtatEnum("mur_etat_entree"),
    murEtatSortie: etatDesLieuxElementEtatEnum("mur_etat_sortie"),
    solDescription: text("sol_description"),
    solEtatEntree: etatDesLieuxElementEtatEnum("sol_etat_entree"),
    solEtatSortie: etatDesLieuxElementEtatEnum("sol_etat_sortie"),
    vitrageVoletsDescription: text("vitrage_volets_description"),
    vitrageVoletsEtatEntree: etatDesLieuxElementEtatEnum("vitrage_volets_etat_entree"),
    vitrageVoletsEtatSortie: etatDesLieuxElementEtatEnum("vitrage_volets_etat_sortie"),
    plafondDescription: text("plafond_description"),
    plafondEtatEntree: etatDesLieuxElementEtatEnum("plafond_etat_entree"),
    plafondEtatSortie: etatDesLieuxElementEtatEnum("plafond_etat_sortie"),
    eclairageDescription: text("eclairage_description"),
    eclairageEtatEntree: etatDesLieuxElementEtatEnum("eclairage_etat_entree"),
    eclairageEtatSortie: etatDesLieuxElementEtatEnum("eclairage_etat_sortie"),
    prisesDescription: text("prises_description"),
    prisesEtatEntree: etatDesLieuxElementEtatEnum("prises_etat_entree"),
    prisesEtatSortie: etatDesLieuxElementEtatEnum("prises_etat_sortie"),
    prisesNombre: integer("prises_nombre")
  },
  (table) => [uniqueIndex("etat_des_lieux_pieces_chambre_numero_unique").on(table.etatDesLieuxId, table.numero)]
);

export const etatDesLieuxPiecesSalleDeBain = pgTable(
  "etat_des_lieux_pieces_salle_de_bain",
  {
    ...auditColumns,
    etatDesLieuxId: uuid("etat_des_lieux_id")
      .notNull()
      .references(() => etatsDesLieux.id),
    // 1 à 2 (jusqu'à 2 salles de bain dans le modèle réel).
    numero: integer("numero").notNull(),
    murDescription: text("mur_description"),
    murEtatEntree: etatDesLieuxElementEtatEnum("mur_etat_entree"),
    murEtatSortie: etatDesLieuxElementEtatEnum("mur_etat_sortie"),
    solDescription: text("sol_description"),
    solEtatEntree: etatDesLieuxElementEtatEnum("sol_etat_entree"),
    solEtatSortie: etatDesLieuxElementEtatEnum("sol_etat_sortie"),
    vitrageVoletsDescription: text("vitrage_volets_description"),
    vitrageVoletsEtatEntree: etatDesLieuxElementEtatEnum("vitrage_volets_etat_entree"),
    vitrageVoletsEtatSortie: etatDesLieuxElementEtatEnum("vitrage_volets_etat_sortie"),
    plafondDescription: text("plafond_description"),
    plafondEtatEntree: etatDesLieuxElementEtatEnum("plafond_etat_entree"),
    plafondEtatSortie: etatDesLieuxElementEtatEnum("plafond_etat_sortie"),
    eclairageDescription: text("eclairage_description"),
    eclairageEtatEntree: etatDesLieuxElementEtatEnum("eclairage_etat_entree"),
    eclairageEtatSortie: etatDesLieuxElementEtatEnum("eclairage_etat_sortie"),
    prisesDescription: text("prises_description"),
    prisesEtatEntree: etatDesLieuxElementEtatEnum("prises_etat_entree"),
    prisesEtatSortie: etatDesLieuxElementEtatEnum("prises_etat_sortie"),
    prisesNombre: integer("prises_nombre"),
    lavaboDescription: text("lavabo_description"),
    lavaboEtatEntree: etatDesLieuxElementEtatEnum("lavabo_etat_entree"),
    lavaboEtatSortie: etatDesLieuxElementEtatEnum("lavabo_etat_sortie"),
    baignoireDescription: text("baignoire_description"),
    baignoireEtatEntree: etatDesLieuxElementEtatEnum("baignoire_etat_entree"),
    baignoireEtatSortie: etatDesLieuxElementEtatEnum("baignoire_etat_sortie")
  },
  (table) => [
    uniqueIndex("etat_des_lieux_pieces_salle_de_bain_numero_unique").on(table.etatDesLieuxId, table.numero)
  ]
);

export const etatDesLieuxPiecesWc = pgTable(
  "etat_des_lieux_pieces_wc",
  {
    ...auditColumns,
    etatDesLieuxId: uuid("etat_des_lieux_id")
      .notNull()
      .references(() => etatsDesLieux.id),
    // 1 à 2 (jusqu'à 2 WC dans le modèle réel).
    numero: integer("numero").notNull(),
    murDescription: text("mur_description"),
    murEtatEntree: etatDesLieuxElementEtatEnum("mur_etat_entree"),
    murEtatSortie: etatDesLieuxElementEtatEnum("mur_etat_sortie"),
    solDescription: text("sol_description"),
    solEtatEntree: etatDesLieuxElementEtatEnum("sol_etat_entree"),
    solEtatSortie: etatDesLieuxElementEtatEnum("sol_etat_sortie"),
    vitrageVoletsDescription: text("vitrage_volets_description"),
    vitrageVoletsEtatEntree: etatDesLieuxElementEtatEnum("vitrage_volets_etat_entree"),
    vitrageVoletsEtatSortie: etatDesLieuxElementEtatEnum("vitrage_volets_etat_sortie"),
    plafondDescription: text("plafond_description"),
    plafondEtatEntree: etatDesLieuxElementEtatEnum("plafond_etat_entree"),
    plafondEtatSortie: etatDesLieuxElementEtatEnum("plafond_etat_sortie"),
    eclairageDescription: text("eclairage_description"),
    eclairageEtatEntree: etatDesLieuxElementEtatEnum("eclairage_etat_entree"),
    eclairageEtatSortie: etatDesLieuxElementEtatEnum("eclairage_etat_sortie"),
    prisesDescription: text("prises_description"),
    prisesEtatEntree: etatDesLieuxElementEtatEnum("prises_etat_entree"),
    prisesEtatSortie: etatDesLieuxElementEtatEnum("prises_etat_sortie"),
    prisesNombre: integer("prises_nombre"),
    lavaboDescription: text("lavabo_description"),
    lavaboEtatEntree: etatDesLieuxElementEtatEnum("lavabo_etat_entree"),
    lavaboEtatSortie: etatDesLieuxElementEtatEnum("lavabo_etat_sortie"),
    // La cuvette elle-même, élément distinct du lavabo — présent tel
    // quel dans le modèle réel.
    wcDescription: text("wc_description"),
    wcEtatEntree: etatDesLieuxElementEtatEnum("wc_etat_entree"),
    wcEtatSortie: etatDesLieuxElementEtatEnum("wc_etat_sortie")
  },
  (table) => [uniqueIndex("etat_des_lieux_pieces_wc_numero_unique").on(table.etatDesLieuxId, table.numero)]
);

export const etatDesLieuxPiecesAutre = pgTable(
  "etat_des_lieux_pieces_autre",
  {
    ...auditColumns,
    etatDesLieuxId: uuid("etat_des_lieux_id")
      .notNull()
      .references(() => etatsDesLieux.id),
    // 1 à 2 (2 emplacements libres dans le modèle réel).
    numero: integer("numero").notNull(),
    // Libellé de la pièce, saisi librement (ex. "Bureau", "Buanderie",
    // ou "Chambre 4" en cas de dépassement du maximum de 3 chambres).
    libelle: text("libelle").notNull(),
    murDescription: text("mur_description"),
    murEtatEntree: etatDesLieuxElementEtatEnum("mur_etat_entree"),
    murEtatSortie: etatDesLieuxElementEtatEnum("mur_etat_sortie"),
    solDescription: text("sol_description"),
    solEtatEntree: etatDesLieuxElementEtatEnum("sol_etat_entree"),
    solEtatSortie: etatDesLieuxElementEtatEnum("sol_etat_sortie"),
    vitrageVoletsDescription: text("vitrage_volets_description"),
    vitrageVoletsEtatEntree: etatDesLieuxElementEtatEnum("vitrage_volets_etat_entree"),
    vitrageVoletsEtatSortie: etatDesLieuxElementEtatEnum("vitrage_volets_etat_sortie"),
    plafondDescription: text("plafond_description"),
    plafondEtatEntree: etatDesLieuxElementEtatEnum("plafond_etat_entree"),
    plafondEtatSortie: etatDesLieuxElementEtatEnum("plafond_etat_sortie"),
    eclairageDescription: text("eclairage_description"),
    eclairageEtatEntree: etatDesLieuxElementEtatEnum("eclairage_etat_entree"),
    eclairageEtatSortie: etatDesLieuxElementEtatEnum("eclairage_etat_sortie"),
    prisesDescription: text("prises_description"),
    prisesEtatEntree: etatDesLieuxElementEtatEnum("prises_etat_entree"),
    prisesEtatSortie: etatDesLieuxElementEtatEnum("prises_etat_sortie"),
    prisesNombre: integer("prises_nombre")
  },
  (table) => [uniqueIndex("etat_des_lieux_pieces_autre_numero_unique").on(table.etatDesLieuxId, table.numero)]
);
