import { pgEnum, pgTable, text } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";

export const sciRegimeFiscalEnum = pgEnum("sci_regime_fiscal", ["IS", "IR"]);
export const sciStatutEnum = pgEnum("sci_statut", ["active", "archive"]);

export const scis = pgTable("scis", {
  ...auditColumns,
  nom: text("nom").notNull(),
  regimeFiscal: sciRegimeFiscalEnum("regime_fiscal").notNull(),
  formeJuridique: text("forme_juridique"),
  siret: text("siret"),
  // Siège social — mention obligatoire du contrat-type pour un bailleur
  // personne morale (décret n° 2015-587), renseignable progressivement
  // (docs/backlog.md, section "Édition d'un bail").
  adresse: text("adresse"),
  codePostal: text("code_postal"),
  ville: text("ville"),
  // Gérant unique (nom/prénom simples) : confirmé avec l'utilisateur,
  // aucune SCI réelle à cogérance — pas de structure à plusieurs
  // représentants légaux tant que ce cas ne se présente pas réellement.
  // Sert au bloc signature du bail, pas une mention obligatoire du
  // contrat-type lui-même.
  nomGerant: text("nom_gerant"),
  prenomGerant: text("prenom_gerant"),
  statut: sciStatutEnum("statut").notNull().default("active")
});
