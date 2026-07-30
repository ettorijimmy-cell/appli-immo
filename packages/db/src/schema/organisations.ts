import { pgEnum, pgTable, text } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";

export const organisationTypeEnum = pgEnum("organisation_type", ["particulier", "syndic"]);
export const organisationStatutEnum = pgEnum("organisation_statut", ["actif", "archive"]);

export const organisations = pgTable("organisations", {
  ...auditColumns,
  type: organisationTypeEnum("type").notNull(),
  nom: text("nom").notNull(),
  emailContact: text("email_contact"),
  // Domicile du bailleur particulier — mention obligatoire du contrat-type
  // (décret n° 2015-587), renseignable progressivement (docs/backlog.md,
  // section "Édition d'un bail") : la génération du bail refusera
  // explicitement si absent, jamais un champ vide dans le document.
  adresse: text("adresse"),
  codePostal: text("code_postal"),
  ville: text("ville"),
  statut: organisationStatutEnum("statut").notNull().default("actif")
});
