import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { organisations } from "./organisations";

// Module Tâches, Étape 3 — intégration Gmail API/OAuth2 (docs/backlog.md,
// 2026-09-01). Une reconnexion (nouveau consentement pour la même
// organisation) archive l'ancienne ligne plutôt que de la modifier en
// place — historique conservé, même principe que revision_loyer (jamais
// réécrite, un fait applicatif à un instant donné). Un simple
// rafraîchissement de jeton (GoogleOAuthService.obtenirAccessTokenValide)
// met à jour la ligne active EN PLACE : ce n'est pas une reconnexion.
export const connexionGmail = pgTable(
  "connexion_gmail",
  {
    ...auditColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    // Adresse Gmail connectée — affichage UI uniquement ("connecté en tant
    // que..."), jamais utilisée pour résoudre l'organisation (organisationId
    // fait foi, résolu côté serveur à la génération de l'URL de
    // consentement, jamais transmis par le client).
    emailCompte: text("email_compte").notNull(),
    // Chiffrés via EncryptionService (AES-256-GCM), même mécanique que
    // comptes_bancaires_sci.iban_chiffre/bic_chiffre — jamais en clair en
    // base, jamais déchiffrés côté apps/desktop (CLAUDE.md).
    accessTokenChiffre: text("access_token_chiffre").notNull(),
    refreshTokenChiffre: text("refresh_token_chiffre").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    scope: text("scope").notNull()
  },
  (table) => [
    // Au plus une connexion active à la fois par organisation — une
    // reconnexion archive l'ancienne ligne avant d'en insérer une
    // nouvelle, jamais deux lignes actives simultanées.
    uniqueIndex("connexion_gmail_organisation_active_unique")
      .on(table.organisationId)
      .where(sql`${table.archivedAt} IS NULL`)
  ]
);
