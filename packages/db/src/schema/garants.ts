import { date, decimal, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { baux } from "./baux";
import { auditColumns } from "./columns.helpers";

export const garantTypeGarantieEnum = pgEnum("garant_type_garantie", [
  "personne_physique",
  "garantie_visale",
  "autre"
]);

export const garants = pgTable("garants", {
  ...auditColumns,
  bailId: uuid("bail_id")
    .notNull()
    .references(() => baux.id),
  nom: text("nom").notNull(),
  prenom: text("prenom").notNull(),
  email: text("email"),
  telephone: text("telephone"),
  typeGarantie: garantTypeGarantieEnum("type_garantie").notNull(),
  // Mentions obligatoires de l'acte de cautionnement sous peine de nullité
  // absolue (loi ALUR) — sans risque à ajouter ici : contrairement à
  // locataires, garants est déjà une ligne par bail (pas une entité
  // partagée), ces champs sont donc figés au moment de la création du
  // cautionnement (docs/backlog.md, section "Édition d'un bail").
  adresse: text("adresse"),
  codePostal: text("code_postal"),
  ville: text("ville"),
  profession: text("profession"),
  revenus: decimal("revenus", { precision: 10, scale: 2 }),
  // Acte de cautionnement (mentions manuscrites légales) — même principe
  // de figement à la création que les champs ci-dessus.
  dateNaissance: date("date_naissance"),
  lieuNaissance: text("lieu_naissance"),
  nationalite: text("nationalite")
});
