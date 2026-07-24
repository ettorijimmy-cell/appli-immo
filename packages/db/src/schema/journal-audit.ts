import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { utilisateurs } from "./utilisateurs";

export const journalAuditActionEnum = pgEnum("journal_audit_action", [
  "creation",
  "modification",
  "archivage",
  "acces"
]);

/**
 * Table transverse, append-only : pas de colonnes d'audit standard
 * (updated_at/version/archived_at) puisqu'une ligne de journal n'est
 * jamais modifiée après écriture.
 */
export const journalAudit = pgTable("journal_audit", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  // Nom de la table concernée, ou "authentification" / "document_sensible"
  // pour les événements de sécurité qui ne portent pas toujours une entité
  // métier identifiable (d'où entiteId nullable).
  entiteType: text("entite_type").notNull(),
  entiteId: uuid("entite_id"),
  action: journalAuditActionEnum("action").notNull(),
  donneesAvant: jsonb("donnees_avant"),
  donneesApres: jsonb("donnees_apres"),
  utilisateurId: uuid("utilisateur_id").references(() => utilisateurs.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});
