import { integer, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { etatsDesLieux } from "./etats-des-lieux";

// 6 types fixes + "autre" (2 emplacements libres dans le modèle réel,
// distingués par une ligne chacun, libelle_autre renseigné uniquement
// pour ce type).
export const etatDesLieuxTypeCleEnum = pgEnum("etat_des_lieux_type_cle", [
  "immeuble",
  "porte_entree",
  "boite_lettres",
  "cave",
  "badge_portail",
  "parking",
  "autre"
]);

export const etatDesLieuxCles = pgTable("etat_des_lieux_cles", {
  ...auditColumns,
  etatDesLieuxId: uuid("etat_des_lieux_id")
    .notNull()
    .references(() => etatsDesLieux.id),
  typeCle: etatDesLieuxTypeCleEnum("type_cle").notNull(),
  // Renseigné uniquement si type_cle = "autre".
  libelleAutre: text("libelle_autre"),
  nombreEntree: integer("nombre_entree"),
  nombreSortie: integer("nombre_sortie"),
  commentaire: text("commentaire")
});
