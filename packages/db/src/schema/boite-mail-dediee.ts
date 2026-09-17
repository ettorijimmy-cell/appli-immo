import { sql } from "drizzle-orm";
import { integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { organisations } from "./organisations";

// Module Messagerie (2026-09-16). Décision technique majeure actée avec
// Jimmy après recherche : jamais l'API Gmail OAuth pour ce module (le
// scope gmail.readonly est classé "restreint" par Google, imposant un
// audit de sécurité payant annuel CASA, 500-4500$/an — disproportionné
// pour un usage interne mono-utilisateur). À la place : IMAP (lecture) +
// SMTP (envoi), authentifiés par un mot de passe d'application Gmail
// (16 caractères, généré côté compte Google, nécessite la validation en
// 2 étapes) — mécanisme standard, entièrement hors du système OAuth/CASA.
export const boiteMailDediee = pgTable(
  "boite_mail_dediee",
  {
    ...auditColumns,
    email: text("email").notNull(),
    // Chiffré via EncryptionService (AES-256-GCM), même mécanique que
    // comptes_bancaires_sci.iban_chiffre/bic_chiffre et connexion_gmail.
    // access_token_chiffre — jamais en clair en base, jamais journalisé,
    // jamais déchiffré côté apps/desktop (CLAUDE.md).
    motDePasseAppChiffre: text("mot_de_passe_app_chiffre").notNull(),
    // Progression de la synchronisation IMAP (ImapSyncJobService) : plus
    // haut UID déjà importé dans message_communication. Les UID IMAP sont
    // strictement croissants au sein d'une boîte (RFC 3501) — le job ne
    // récupère que UID > dernierUidSynchronise, jamais une fenêtre de
    // dates (pas de fuseau horaire à négocier avec le serveur IMAP). Null
    // tant qu'aucune synchronisation n'a encore eu lieu (récupère tout
    // l'historique disponible au premier passage).
    dernierUidSynchronise: integer("dernier_uid_synchronise"),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id)
  },
  (table) => [
    // Au plus une boîte active à la fois par organisation — même principe
    // que connexion_gmail_organisation_active_unique : une reconfiguration
    // archive l'ancienne ligne avant d'en insérer une nouvelle, jamais
    // deux lignes actives simultanées.
    uniqueIndex("boite_mail_dediee_organisation_active_unique")
      .on(table.organisationId)
      .where(sql`${table.archivedAt} IS NULL`)
  ]
);
