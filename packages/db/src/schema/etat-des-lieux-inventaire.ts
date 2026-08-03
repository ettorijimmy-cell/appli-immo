import { integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { elementsInventaireMeuble } from "./elements-inventaire-meuble";
import { etatDesLieuxInventaireEtatEnum, etatsDesLieux } from "./etats-des-lieux";

// Pertinent uniquement pour un bail meublé (bail.type_bail = "meuble")
// — règle applicative (bloc {#meublé} du modèle Word), pas une
// contrainte de schéma : aucune colonne ne l'impose ici.
export const etatDesLieuxInventaire = pgTable(
  "etat_des_lieux_inventaire",
  {
    ...auditColumns,
    etatDesLieuxId: uuid("etat_des_lieux_id")
      .notNull()
      .references(() => etatsDesLieux.id),
    elementId: uuid("element_id")
      .notNull()
      .references(() => elementsInventaireMeuble.id),
    nombreEntree: integer("nombre_entree"),
    etatEntree: etatDesLieuxInventaireEtatEnum("etat_entree"),
    nombreSortie: integer("nombre_sortie"),
    etatSortie: etatDesLieuxInventaireEtatEnum("etat_sortie"),
    commentaire: text("commentaire")
  },
  (table) => [
    uniqueIndex("etat_des_lieux_inventaire_element_unique").on(table.etatDesLieuxId, table.elementId)
  ]
);
