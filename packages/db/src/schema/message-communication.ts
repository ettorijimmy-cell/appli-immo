import { sql } from "drizzle-orm";
import { pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { organisations } from "./organisations";

export const messageDirectionEnum = pgEnum("message_direction", ["envoye", "recu"]);

// Résolu par correspondance exacte d'adresse email contre contact.email/
// locataires.email/candidat.email/garants.email (packages/core,
// resoudreClassificationEmail) — jamais un choix arbitraire en cas
// d'ambiguïté (plusieurs entités distinctes partagent l'adresse) ou
// d'absence de correspondance : le message reste 'non_classe', même
// discipline que suggererCategorie (Charges et fiscalité).
// "garant" ajouté après coup (sélecteur de destinataire depuis le Carnet
// de contacts, 2026-09-16) : la classification immédiate d'un message
// composé vers un garant choisi dans le carnet exigeait cette valeur, qui
// manquait par oubli dans le schéma cible initial du module Messagerie.
export const messageClassificationTypeEnum = pgEnum("message_classification_type", [
  "contact",
  "locataire",
  "candidat",
  "garant",
  "non_classe"
]);

export const messageCommunication = pgTable(
  "message_communication",
  {
    ...auditColumns,
    direction: messageDirectionEnum("direction").notNull(),
    objet: text("objet"),
    // Corps texte brut : parsed.text (mailparser) pour un message reçu, ou
    // le texte tapé dans le formulaire de composition desktop pour un
    // message envoyé (jamais de HTML à l'envoi, hors périmètre de cette
    // itération). Colonne SQL restée "corps" (nom historique) plutôt que
    // renommée en "corps_texte" — un renommage de colonne n'est pas
    // détectable de façon fiable par `drizzle-kit generate` en mode non
    // interactif, ça aurait risqué une perte de données (DROP + ADD) sur
    // tout l'historique des messages ; seul le nom côté code change,
    // 2026-09-16 (bug corrigé : balises HTML brutes affichées telles
    // quelles côté desktop).
    corpsTexte: text("corps"),
    // Corps HTML **déjà nettoyé** (sanitize-html, ImapSyncJobService) —
    // jamais le HTML brut d'un email reçu, contenu externe non fiable
    // (risque XSS réel). `null` pour les messages envoyés (composition
    // reste texte brut) et pour les messages reçus sans partie HTML.
    // Nettoyage en profondeur : une deuxième passe (DOMPurify) a lieu côté
    // desktop juste avant l'insertion dans le DOM, même discipline que la
    // validation du montant négatif (front + back) — jamais une seule
    // ligne de défense pour du contenu externe non fiable.
    corpsHtml: text("corps_html"),
    emailExpediteur: text("email_expediteur").notNull(),
    emailDestinataire: text("email_destinataire").notNull(),
    dateMessage: timestamp("date_message", { withTimezone: true }).notNull(),
    // En-tête RFC 5322/2822 'Message-ID', exposé par imapflow — sert au
    // dédoublonnage à la synchronisation (ImapSyncJobService), jamais
    // renseigné pour direction='envoye' : un message composé depuis cette
    // application n'a pas encore d'identifiant côté serveur IMAP au moment
    // de l'insertion (SmtpEnvoiService journalise avant tout aller-retour
    // avec le serveur). Nullable + index unique partiel plutôt qu'un
    // identifiant synthétique inventé — un message envoyé n'a rien à
    // dédoublonner, un identifiant de substitution laisserait croire au
    // contraire (ajustement au schéma cible fourni, décision actée avec
    // Jimmy après audit préalable, 2026-09-16).
    imapMessageId: text("imap_message_id"),
    classificationType: messageClassificationTypeEnum("classification_type").notNull().default("non_classe"),
    // Id du contact/locataire/candidat selon classificationType — pas de FK
    // possible (cible différente selon le type), même principe que
    // alertes.entiteId/documents.entiteId.
    classificationId: uuid("classification_id"),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id)
  },
  (table) => [
    uniqueIndex("message_communication_imap_id_unique")
      .on(table.organisationId, table.imapMessageId)
      .where(sql`${table.imapMessageId} IS NOT NULL`)
  ]
);

// Pièces jointes reçues : capturées et stockées (Object Storage via
// DocumentStorageService/StorageModule), avec un visualiseur intégré dans
// le fil de messagerie — jamais classées automatiquement dans le système
// `documents` polymorphe. Une action manuelle "Classer dans Documents"
// (MessagesCommunicationService.classerDansDocuments) reste disponible si
// Jimmy veut la conserver durablement avec une vraie catégorie — elle crée
// alors une ligne `documents` séparée (copie du contenu, jamais un
// partage de cheminStockage entre les deux tables).
export const pieceJointeMessage = pgTable("piece_jointe_message", {
  ...auditColumns,
  messageId: uuid("message_id")
    .notNull()
    .references(() => messageCommunication.id),
  nomFichier: text("nom_fichier").notNull(),
  cheminStockage: text("chemin_stockage").notNull(),
  typeMime: text("type_mime"),
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id)
});
