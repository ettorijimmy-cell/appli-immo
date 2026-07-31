import { date, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";

export const locataireStatutEnum = pgEnum("locataire_statut", ["actif", "ancien", "archive"]);

export const locataires = pgTable("locataires", {
  ...auditColumns,
  nom: text("nom").notNull(),
  prenom: text("prenom").notNull(),
  email: text("email"),
  telephone: text("telephone"),
  // Mentions du modèle de bail (identité du LOCATAIRE), renseignables
  // progressivement — même principe que les champs équivalents sur scis
  // (docs/backlog.md, section "Édition d'un bail").
  adresse: text("adresse"),
  codePostal: text("code_postal"),
  ville: text("ville"),
  dateNaissance: date("date_naissance"),
  statut: locataireStatutEnum("statut").notNull().default("actif"),
  // Renseigné lors d'une anonymisation RGPD : les champs identifiants sont
  // alors neutralisés applicativement, la ligne elle-même n'est jamais
  // supprimée (voir docs/data-dictionary.md).
  anonymiseLe: timestamp("anonymise_le", { withTimezone: true })
});
