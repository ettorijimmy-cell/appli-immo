import { pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { organisations } from "./organisations";

// Module Carnet de contacts (2026-09-13). Un contact professionnel
// (artisan, diagnostiqueur, syndic, assureur...) n'est jamais rattaché à
// un bien précis — fiche indépendante, décision actée avec Jimmy. Pas de
// pièce jointe à cette étape (non demandé, pas anticipé). Un seul champ
// `nom` couvre personne physique ET entreprise (pas de séparation nom/
// prénom/raison sociale) — locataires/garants restent gérés dans leurs
// modules respectifs, jamais dupliqués ici.
export const contactTypeEntiteEnum = pgEnum("contact_type_entite", ["personne_physique", "entreprise"]);
export const contactRoleEnum = pgEnum("contact_role", ["artisan", "diagnostiqueur", "syndic", "assureur", "autre"]);

export const contact = pgTable("contact", {
  ...auditColumns,
  nom: text("nom").notNull(),
  typeEntite: contactTypeEntiteEnum("type_entite").notNull(),
  role: contactRoleEnum("role").notNull(),
  telephone: text("telephone"),
  email: text("email"),
  notes: text("notes"),
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id)
});
