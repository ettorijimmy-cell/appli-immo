import { date, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { organisations } from "./organisations";

export const locataireStatutEnum = pgEnum("locataire_statut", ["actif", "ancien", "archive"]);

export const locataires = pgTable("locataires", {
  ...auditColumns,
  nom: text("nom").notNull(),
  prenom: text("prenom").notNull(),
  email: text("email"),
  telephone: text("telephone"),
  // Ajouté nullable puis backfillé (scripts/backfill-organisation-
  // locataires-garants.ts, jointure locataire -> bail_locataires -> baux
  // -> appartements -> bien -> organisation_id) avant ce passage en NOT
  // NULL — même méthode en deux phases que appartements.bien_id (migration
  // bien, 2026-08-27). Corrige un écart découvert au Module Carnet de
  // contacts (2026-09-13) : LocatairesService.findAll() ne filtrait par
  // aucune organisation jusqu'ici (contrairement à depense/tache).
  // Résolu à la création (LocatairesService.create()), jamais déduit par
  // jointure à la lecture : un locataire peut exister avant d'être
  // rattaché à un bail (LocatairesListView permet une création autonome),
  // une jointure via bail_locataires seule l'aurait fait disparaître de
  // sa propre liste tant qu'il n'est pas affecté.
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id),
  // Mentions du modèle de bail (identité du LOCATAIRE), renseignables
  // progressivement — même principe que les champs équivalents sur scis
  // (docs/backlog.md, section "Édition d'un bail").
  adresse: text("adresse"),
  codePostal: text("code_postal"),
  ville: text("ville"),
  dateNaissance: date("date_naissance"),
  // Même besoin que garants.lieu_naissance (déclaration fiscale annuelle
  // du bailleur, date + lieu de naissance du locataire requis) — jamais
  // renseigné jusqu'ici côté locataires, docs/backlog.md, checklist
  // documentaire.
  lieuNaissance: text("lieu_naissance"),
  statut: locataireStatutEnum("statut").notNull().default("actif"),
  // Renseigné lors d'une anonymisation RGPD : les champs identifiants sont
  // alors neutralisés applicativement, la ligne elle-même n'est jamais
  // supprimée (voir docs/data-dictionary.md).
  anonymiseLe: timestamp("anonymise_le", { withTimezone: true })
});
