import { integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { etatDesLieuxInventaireEtatEnum, etatsDesLieux } from "./etats-des-lieux";

// Liste extensible, libellé saisi librement — pas de catalogue fixe
// (décision du propriétaire). Section "ÉQUIPEMENTS DIVERS" du modèle
// réel, placée hors du bloc {#meublé} : applicable à tout bail, vide ou
// meublé. Échelle Bon/D'usage/Mauvais (comme l'inventaire meublé), pas
// M/P/B/TB (comme les pièces).
export const etatDesLieuxEquipementsDivers = pgTable("etat_des_lieux_equipements_divers", {
  ...auditColumns,
  etatDesLieuxId: uuid("etat_des_lieux_id")
    .notNull()
    .references(() => etatsDesLieux.id),
  libelle: text("libelle").notNull(),
  nombreEntree: integer("nombre_entree"),
  etatEntree: etatDesLieuxInventaireEtatEnum("etat_entree"),
  nombreSortie: integer("nombre_sortie"),
  etatSortie: etatDesLieuxInventaireEtatEnum("etat_sortie"),
  commentaire: text("commentaire")
});
