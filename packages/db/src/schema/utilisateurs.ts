import { pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { organisations } from "./organisations";

export const utilisateurStatutEnum = pgEnum("utilisateur_statut", ["actif", "archive"]);

export const utilisateurs = pgTable("utilisateurs", {
  ...auditColumns,
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id),
  email: text("email").notNull().unique(),
  nom: text("nom").notNull(),
  prenom: text("prenom").notNull(),
  motDePasseHash: text("mot_de_passe_hash").notNull(),
  statut: utilisateurStatutEnum("statut").notNull().default("actif")
});
