import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { documents } from "./documents";
import { etatDesLieuxPhaseEnum, etatsDesLieux } from "./etats-des-lieux";
import { locataires } from "./locataires";
import { messageCommunication } from "./message-communication";
import { organisations } from "./organisations";

// en_cours : ligne écrite AVANT l'appel SMTP, pour qu'un arrêt du serveur
// en plein envoi laisse une trace. indetermine : en_cours abandonnée, le
// mail a pu partir ou non.
export const etatDesLieuxEnvoiStatutEnum = pgEnum("etat_des_lieux_envoi_statut", [
  "en_cours",
  "envoye",
  "echec",
  "indetermine"
]);

// Preuve de remise de l'état des lieux (décret n° 2016-382, art. 3, 3°) :
// une ligne par tentative et par destinataire, jamais supprimée (trigger
// etat_des_lieux_envoi_sans_suppression, posé à la main dans la migration).
// Hors publication et hors PowerSync, lue en REST uniquement. Les valeurs
// sont copiées à l'envoi plutôt que relues : la preuve reste juste si la
// fiche locataire change ensuite. "envoye" signifie accepté par le serveur
// SMTP, pas reçu par le destinataire. Voir docs/data-dictionary.md.
export const etatDesLieuxEnvoi = pgTable(
  "etat_des_lieux_envoi",
  {
    ...auditColumns,
    etatDesLieuxId: uuid("etat_des_lieux_id")
      .notNull()
      .references(() => etatsDesLieux.id),
    phase: etatDesLieuxPhaseEnum("phase").notNull(),
    locataireId: uuid("locataire_id")
      .notNull()
      .references(() => locataires.id),
    // Le PDF figé exact, et son empreinte pour prouver quel contenu est parti.
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    pdfSha256: text("pdf_sha256").notNull(),
    // Sortie après une entrée établie sur papier (2026-11-06) : le scan de
    // l'entrée joint au même mail, et l'empreinte des octets exacts joints.
    // Toujours ensemble, NULL pour tout autre envoi.
    scanDocumentId: uuid("scan_document_id").references(() => documents.id),
    scanSha256: text("scan_sha256"),
    // Une par confirmation à l'écran : la rejouer renvoie le résultat
    // existant plutôt qu'un second mail (double clic, réponse réseau perdue).
    demandeId: uuid("demande_id").notNull(),
    nomDestinataire: text("nom_destinataire").notNull(),
    adresseUtilisee: text("adresse_utilisee").notNull(),
    // Connue seulement une fois les identifiants de la boîte lus.
    adresseExpediteur: text("adresse_expediteur"),
    objet: text("objet").notNull(),
    statut: etatDesLieuxEnvoiStatutEnum("statut").notNull().default("en_cours"),
    tenteLe: timestamp("tente_le", { withTimezone: true }).notNull(),
    envoyeLe: timestamp("envoye_le", { withTimezone: true }),
    smtpMessageId: text("smtp_message_id"),
    smtpReponse: text("smtp_reponse"),
    codeErreur: text("code_erreur"),
    // Message français affiché à l'utilisateur, jamais le texte du serveur.
    messageErreur: text("message_erreur"),
    // NULL si le mail est parti sans pouvoir être journalisé dans la messagerie.
    messageCommunicationId: uuid("message_communication_id").references(() => messageCommunication.id),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id)
  },
  (table) => [
    uniqueIndex("etat_des_lieux_envoi_demande_unique").on(table.demandeId, table.locataireId),
    // Un seul envoi en cours par destinataire et par phase, tous appareils
    // confondus.
    uniqueIndex("etat_des_lieux_envoi_en_cours_unique")
      .on(table.etatDesLieuxId, table.phase, table.locataireId)
      .where(sql`${table.statut} = 'en_cours'`),
    index("etat_des_lieux_envoi_historique_idx").on(table.etatDesLieuxId, table.phase),
    check(
      "etat_des_lieux_envoi_envoye_coherent",
      sql`(${table.statut} = 'envoye') = (${table.envoyeLe} IS NOT NULL)`
    ),
    check(
      "etat_des_lieux_envoi_scan_coherent",
      sql`(${table.scanDocumentId} IS NULL) = (${table.scanSha256} IS NULL)`
    ),
    check(
      "etat_des_lieux_envoi_echec_coherent",
      sql`${table.statut} <> 'echec' OR ${table.codeErreur} IS NOT NULL`
    )
  ]
);
