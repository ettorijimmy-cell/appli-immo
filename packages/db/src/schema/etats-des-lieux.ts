import { date, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { baux } from "./baux";
import { auditColumns } from "./columns.helpers";

// Échelle de l'état des pièces (décret n° 2016-382, art. 2 : mauvais,
// passable, bon, très bon) — volontairement distincte de l'échelle
// Bon/D'usage/Mauvais de l'inventaire meublé ci-dessous, décision assumée
// avec le propriétaire (docs/backlog.md, "État des lieux").
export const etatDesLieuxElementEtatEnum = pgEnum("etat_des_lieux_element_etat", [
  "M",
  "P",
  "B",
  "TB"
]);

// Échelle de l'inventaire meublé (mobilier/électroménager/vaisselle-linge)
// et de "ÉQUIPEMENTS DIVERS" — non harmonisée avec l'échelle ci-dessus.
export const etatDesLieuxInventaireEtatEnum = pgEnum("etat_des_lieux_inventaire_etat", [
  "bon",
  "dusage",
  "mauvais"
]);

// Un seul état des lieux par bail (bail_id unique) : le même document
// couvre l'entrée et la sortie (décret n° 2016-382, art. 3, 2° — "document
// unique" permettant la comparaison), pas deux enregistrements séparés.
// date_sortie et nouvelle_adresse_locataire restent nuls jusqu'à la
// visite de sortie, potentiellement des mois ou années après la création.
export const etatsDesLieux = pgTable("etats_des_lieux", {
  ...auditColumns,
  bailId: uuid("bail_id")
    .notNull()
    .unique()
    .references(() => baux.id),
  dateEntree: date("date_entree"),
  dateSortie: date("date_sortie"),
  // Seul champ "domicile" du locataire porté par ce document (décret
  // n° 2016-382, art. 2, 2° a) — connu uniquement à la sortie, jamais
  // à l'entrée. Texte libre, décision assumée avec le propriétaire.
  nouvelleAdresseLocataire: text("nouvelle_adresse_locataire")
});
