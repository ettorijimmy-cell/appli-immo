import { integer, pgEnum, pgTable, text } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";

export const elementInventaireMeubleCategorieEnum = pgEnum("element_inventaire_meuble_categorie", [
  "meuble",
  "electromenager",
  "vaisselle_linge"
]);

// Catalogue de référence (~85 postes fixes du modèle réel, section
// inventaire du bail meublé) — table de données seed, pas modifiable en
// usage courant. "vaisselle_linge" regroupe les deux colonnes
// d'impression "ÉQUIPEMENT 1"/"ÉQUIPEMENT 2" du modèle réel, qui n'ont
// aucune signification métier (mise en page uniquement, pas deux
// catégories distinctes). Seed des ~85 lignes à faire au moment de
// construire le service (docs/backlog.md, "État des lieux").
export const elementsInventaireMeuble = pgTable("elements_inventaire_meuble", {
  ...auditColumns,
  code: text("code").notNull().unique(),
  libelle: text("libelle").notNull(),
  categorie: elementInventaireMeubleCategorieEnum("categorie").notNull(),
  // Ordre d'affichage au sein de sa catégorie, pour reproduire l'ordre
  // du modèle réel plutôt qu'un tri alphabétique.
  ordreAffichage: integer("ordre_affichage").notNull()
});
