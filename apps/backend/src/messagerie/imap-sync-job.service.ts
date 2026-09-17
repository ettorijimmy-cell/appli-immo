import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { boiteMailDediee, messageCommunication, pieceJointeMessage, type Database } from "db";
import { and, eq, isNull } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import sanitizeHtml from "sanitize-html";
import { uuidv7 } from "uuidv7";
import { DATABASE_CONNECTION } from "../database/database.module";
import { DocumentStorageService } from "../storage/document-storage.service";
import { BoiteMailDedieeService } from "./boite-mail-dediee.service";
import { ClassificationMessageService } from "./classification-message.service";

const IMAP_HOST = "imap.gmail.com";
const IMAP_PORT = 993;

// Le HTML d'un email reçu est un contenu externe non fiable (risque XSS
// réel — cf. audit préalable, 2026-09-16) : allowlist stricte plutôt que
// les valeurs par défaut de sanitize-html. Volontairement exclu de cette
// itération : <img> — les emails HTML embarquent souvent des pixels de
// suivi (src distant) ou des images cid: déjà réencodées par mailparser en
// data: URI potentiellement lourdes ; aucune demande explicite pour les
// images, seulement "gras, liens, mise en forme". Repli exact sur le
// visualiseur de pièce jointe existant pour toute image jointe.
const OPTIONS_SANITIZE_HTML_MESSAGE_RECU: sanitizeHtml.IOptions = {
  allowedTags: [
    "b",
    "strong",
    "i",
    "em",
    "u",
    "p",
    "br",
    "div",
    "span",
    "ul",
    "ol",
    "li",
    "a",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "table",
    "thead",
    "tbody",
    "tr",
    "td",
    "th"
  ],
  allowedAttributes: { a: ["href"] },
  // Bloque explicitement javascript:/data: en href — seuls des liens
  // authentiques (http/https) ou mailto ont un sens dans un email reçu.
  allowedSchemes: ["http", "https", "mailto"],
  disallowedTagsMode: "discard"
};

type BoiteMailDedieeRow = typeof boiteMailDediee.$inferSelect;

function premiereAdresse(champ: AddressObject | AddressObject[] | undefined): string {
  if (!champ) {
    return "";
  }
  const objet = Array.isArray(champ) ? champ[0] : champ;
  return objet?.value[0]?.address ?? "";
}

/**
 * Module Messagerie (2026-09-16) : synchronisation périodique de la boîte
 * mail dédiée, une par organisation. Récupère incrémentalement par UID
 * (RFC 3501, strictement croissant au sein d'une boîte — jamais une
 * fenêtre de dates) depuis boiteMailDediee.dernierUidSynchronise, dédouble
 * via imapMessageId (index unique partiel, voir packages/db/src/schema/
 * message-communication.ts), résout la classification, stocke les pièces
 * jointes (StorageModule, sans jamais créer de ligne `documents`).
 *
 * Uniquement le dossier INBOX : les messages envoyés depuis cette
 * application sont déjà journalisés directement par SmtpEnvoiService au
 * moment de l'envoi (direction='envoye') — synchroniser aussi le dossier
 * "Envoyés" IMAP dupliquerait ces mêmes messages sous un autre chemin,
 * sans information supplémentaire.
 */
@Injectable()
export class ImapSyncJobService {
  private readonly logger = new Logger(ImapSyncJobService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly boiteMailDedieeService: BoiteMailDedieeService,
    private readonly classificationMessageService: ClassificationMessageService,
    private readonly documentStorageService: DocumentStorageService
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async executerJobPeriodique(): Promise<void> {
    const nombreImportes = await this.synchroniserToutesLesBoites();
    this.logger.log(`Synchronisation IMAP exécutée : ${nombreImportes} message(s) importé(s).`);
  }

  async synchroniserToutesLesBoites(): Promise<number> {
    const boites = await this.db.select().from(boiteMailDediee).where(isNull(boiteMailDediee.archivedAt));
    let total = 0;
    for (const boite of boites) {
      try {
        total += await this.synchroniserBoite(boite);
      } catch (err) {
        // Une boîte en échec (jeton révoqué, réseau...) ne doit jamais
        // empêcher la synchronisation des autres organisations — jamais
        // le mot de passe d'application dans ce message (CLAUDE.md).
        const messageErreur = err instanceof Error ? err.message : String(err);
        this.logger.error(`Échec de synchronisation pour la boîte ${boite.id} : ${messageErreur}`);
      }
    }
    return total;
  }

  async synchroniserBoite(boite: BoiteMailDedieeRow): Promise<number> {
    const { email, motDePasseApp } = await this.boiteMailDedieeService.obtenirIdentifiants(boite.organisationId);

    const client = new ImapFlow({
      host: IMAP_HOST,
      port: IMAP_PORT,
      secure: true,
      auth: { user: email, pass: motDePasseApp },
      logger: false
    });

    let nombreImportes = 0;
    let plusHautUid = boite.dernierUidSynchronise ?? 0;

    await client.connect();
    try {
      const lock = await client.getMailboxLock("INBOX");
      try {
        const uidDepart = plusHautUid + 1;
        for await (const message of client.fetch(`${uidDepart}:*`, { uid: true, source: true }, { uid: true })) {
          if (message.uid <= plusHautUid || !message.source) {
            continue;
          }
          const importe = await this.importerMessage(boite.organisationId, message.source);
          if (importe) {
            nombreImportes += 1;
          }
          plusHautUid = Math.max(plusHautUid, message.uid);
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }

    if (plusHautUid > (boite.dernierUidSynchronise ?? 0)) {
      await this.boiteMailDedieeService.mettreAJourDernierUidSynchronise(boite.id, plusHautUid);
    }

    return nombreImportes;
  }

  private async importerMessage(organisationId: string, source: Buffer): Promise<boolean> {
    const parsed = await simpleParser(source);
    // Fallback stable et unique si l'en-tête Message-ID est absent (rare,
    // messages malformés) — jamais un identifiant qui pourrait dédoublonner
    // par erreur deux messages distincts.
    const imapMessageId = parsed.messageId ?? `sans-message-id-${uuidv7()}`;

    const [existant] = await this.db
      .select({ id: messageCommunication.id })
      .from(messageCommunication)
      .where(
        and(eq(messageCommunication.organisationId, organisationId), eq(messageCommunication.imapMessageId, imapMessageId))
      )
      .limit(1);
    if (existant) {
      return false;
    }

    const emailExpediteur = premiereAdresse(parsed.from);
    const emailDestinataire = premiereAdresse(parsed.to);
    const classification = await this.classificationMessageService.resoudre(emailExpediteur, organisationId);

    // corpsHtml nettoyé une fois ici, à la réception — jamais le HTML brut
    // stocké (audit préalable, 2026-09-16). Une deuxième passe (DOMPurify)
    // a lieu côté desktop juste avant le rendu, défense en profondeur.
    const corpsHtml = parsed.html !== false ? sanitizeHtml(parsed.html, OPTIONS_SANITIZE_HTML_MESSAGE_RECU) : null;

    const [ligne] = await this.db
      .insert(messageCommunication)
      .values({
        direction: "recu",
        objet: parsed.subject ?? null,
        corpsTexte: parsed.text ?? null,
        corpsHtml,
        emailExpediteur,
        emailDestinataire,
        dateMessage: parsed.date ?? new Date(),
        imapMessageId,
        classificationType: classification.type,
        classificationId: classification.id,
        organisationId
      })
      .returning();
    if (!ligne) {
      throw new Error("Échec de l'insertion du message reçu");
    }

    for (const piece of parsed.attachments) {
      const pieceJointeId = uuidv7();
      const chemin = `messages/${ligne.id}/${pieceJointeId}.enc`;
      await this.documentStorageService.enregistrer(piece.content, chemin);
      await this.db.insert(pieceJointeMessage).values({
        id: pieceJointeId,
        messageId: ligne.id,
        nomFichier: piece.filename ?? "piece-jointe",
        cheminStockage: chemin,
        typeMime: piece.contentType,
        organisationId
      });
    }

    return true;
  }
}
