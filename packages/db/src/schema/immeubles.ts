import { integer, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { scis } from "./scis";

export const immeubleStatutEnum = pgEnum("immeuble_statut", ["actif", "archive"]);

// Caractéristiques du bâtiment (mentions du contrat-type, décret
// n° 2015-587) — au niveau immeuble, pas appartement : un lot ne change
// pas le régime de copropriété ni le type d'habitat de tout le bâtiment
// (docs/backlog.md, section "Édition d'un bail").
export const immeubleTypeHabitatEnum = pgEnum("immeuble_type_habitat", ["collectif", "individuel"]);
export const immeubleRegimeJuridiqueEnum = pgEnum("immeuble_regime_juridique", [
  "mono_propriete",
  "copropriete"
]);

export const immeubles = pgTable("immeubles", {
  ...auditColumns,
  // FK directe vers scis, pas de table de liaison — contrairement à
  // organisation_sci, un immeuble appartient à exactement une SCI.
  sciId: uuid("sci_id")
    .notNull()
    .references(() => scis.id),
  nom: text("nom").notNull(),
  adresse: text("adresse").notNull(),
  codePostal: text("code_postal"),
  ville: text("ville"),
  typeHabitat: immeubleTypeHabitatEnum("type_habitat"),
  regimeJuridique: immeubleRegimeJuridiqueEnum("regime_juridique"),
  // Année précise plutôt que tranche officielle du contrat-type ("avant
  // 1949", "1949-1974"...) : packages/core dérive la tranche à
  // l'affichage, réutilisable ailleurs qu'à la seule édition du bail
  // (docs/backlog.md).
  anneeConstruction: integer("annee_construction"),
  statut: immeubleStatutEnum("statut").notNull().default("actif")
});
