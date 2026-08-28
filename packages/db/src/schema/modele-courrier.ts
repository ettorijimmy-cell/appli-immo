import { jsonb, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { organisations } from "./organisations";

// Une seule valeur pour l'instant, mais pgEnum retenu (pas text+CHECK) :
// aucun précédent text+CHECK dans ce schéma, canal est explicitement
// destiné à grandir (lettre, puis SMS/notification via le futur module
// Messagerie — docs/backlog.md), et ce codebase a déjà fait grandir un
// pgEnum via ALTER TYPE ... ADD VALUE plusieurs fois (ex.
// document_entite_type). Voir échange du 2026-08-29.
export const modeleCourrierCanalEnum = pgEnum("modele_courrier_canal", ["email"]);

// Brique transverse (Module Tâches, Étape 2, 2026-08-29) : pose
// l'infrastructure (table, moteur de résolution packages/core, mécanisme de
// seed idempotent) sans le vrai contenu de quittance — celui-ci arrive à
// l'Étape 4, une fois les données réellement disponibles à la génération
// connues avec certitude. Ne pas confondre avec le mécanisme docxtemplater
// (bail-document-docx/etat-des-lieux-document-docx) : fichier .docx binaire
// sur disque avec mapping de balises codé en dur, pas un modèle texte en
// base avec substitution {{variable}}.
export const modeleCourrier = pgTable("modele_courrier", {
  ...auditColumns,
  // Identifiant stable utilisé par le code consommateur (ex.
  // 'quittance_mensuelle'), jamais l'id technique — permet de faire évoluer
  // le contenu d'un modèle sans casser les appelants.
  code: text("code").notNull().unique(),
  nom: text("nom").notNull(),
  canal: modeleCourrierCanalEnum("canal").notNull().default("email"),
  // Nullable : un futur canal 'lettre' n'a pas d'objet (pas d'équivalent
  // au sujet d'un email).
  objet: text("objet"),
  // Syntaxe {{variable}}, résolue par packages/core, resoudreModeleCourrier.
  corps: text("corps").notNull(),
  // Array de string (noms des variables attendues par ce modèle) — permet
  // à un appelant de valider ses données avant résolution, sans dépendre
  // d'un parsing du corps à chaque appel.
  variablesRequises: jsonb("variables_requises").notNull().$type<string[]>(),
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id)
});
