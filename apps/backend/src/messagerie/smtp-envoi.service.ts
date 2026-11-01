import { Inject, Injectable, Logger } from "@nestjs/common";
import { messageCommunication, pieceJointeMessage, type Database } from "db";
import type { ResultatClassification } from "core";
import { uuidv7 } from "uuidv7";
import nodemailer from "nodemailer";
import { DATABASE_CONNECTION } from "../database/database.module";
import { DocumentStorageService } from "../storage/document-storage.service";
import { BoiteMailDedieeService } from "./boite-mail-dediee.service";
import { ClassificationMessageService } from "./classification-message.service";
import { EnvoiSmtpEchoueException } from "./envoi-smtp-echoue.exception";

// Gmail SMTP (mot de passe d'application, PAS OAuth — voir
// packages/db/src/schema/boite-mail-dediee.ts pour la décision technique).
export const SMTP_HOST = "smtp.gmail.com";
// 587 en STARTTLS obligatoire : Scaleway bloque le 465 en sortie des
// Serverless Containers (GET /diagnostic/smtp en production, 2026-11-01 :
// 465 en échec ESOCKET, 587 entièrement fonctionnel).
const SMTP_PORT = 587;
const DELAI_CONNEXION_MS = 15_000;
const DELAI_ACCUEIL_MS = 15_000;
const DELAI_DNS_MS = 10_000;
// Inactivité, pas durée totale : l'envoi d'une pièce jointe lourde reste
// possible tant que le serveur répond.
const DELAI_SOCKET_MS = 60_000;

export interface PieceJointeEmail {
  nomFichier: string;
  contenu: Buffer;
  mimeType: string;
}

// Preuve d'un envoi accepté par le serveur SMTP, pas d'une réception par le
// destinataire : un rebond éventuel arrive plus tard dans la boîte dédiée.
export interface AccuseEnvoiSmtp {
  expediteur: string;
  smtpMessageId: string | null;
  reponseServeur: string | null;
  // null si le mail est parti mais que sa journalisation a échoué.
  messageCommunicationId: string | null;
}

/**
 * Remplace GoogleOAuthService.envoyerEmail comme mécanisme d'envoi pour
 * TachesService.envoyerNotification (Module Messagerie, unification
 * 2026-09-16, décision actée avec Jimmy) — signature identique pour
 * limiter le changement au strict nécessaire côté TachesService : seul le
 * mécanisme d'envoi physique change (SMTP via mot de passe d'application
 * plutôt que l'API Gmail via OAuth), la résolution destinataire/modèle de
 * courrier/génération PDF en amont reste identique. Journalise chaque
 * envoi dans message_communication (direction='envoye') — symétrique à
 * ImapSyncJobService côté réception, pour que l'écran Messagerie affiche
 * un fil unifié envoyé+reçu.
 */
@Injectable()
export class SmtpEnvoiService {
  private readonly logger = new Logger(SmtpEnvoiService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly boiteMailDedieeService: BoiteMailDedieeService,
    private readonly classificationMessageService: ClassificationMessageService,
    private readonly documentStorageService: DocumentStorageService
  ) {}

  // Renvoie l'id du message_communication journalisé, ou null si le mail est
  // parti sans pouvoir être journalisé — jamais lu par
  // TachesService.envoyerNotification (seul appelant historique, qui
  // ignore la valeur de retour), utilisé uniquement par
  // MessagesCommunicationService.composer() pour renvoyer le message créé.
  async envoyerEmail(
    organisationId: string,
    destinataire: string,
    objet: string,
    corps: string,
    pieceJointe?: PieceJointeEmail,
    classificationChoisie?: ResultatClassification
  ): Promise<string | null> {
    const accuse = await this.envoyerAvecAccuse(organisationId, destinataire, objet, corps, pieceJointe, classificationChoisie);
    return accuse.messageCommunicationId;
  }

  // Rejette uniquement si le mail n'est PAS parti. Une fois le serveur SMTP
  // d'accord, plus rien ne peut transformer cet envoi en erreur : un échec
  // de journalisation laisserait croire à un échec d'envoi et pousserait à
  // renvoyer le même mail.
  //
  // classificationChoisie (optionnel) : classification déjà connue de
  // l'appelant (destinataire choisi depuis le Carnet de contacts,
  // sélecteur desktop 2026-09-16) — bypass la résolution par adresse email
  // (ClassificationMessageService.resoudre), jamais utilisée en même
  // temps que cette résolution automatique.
  async envoyerAvecAccuse(
    organisationId: string,
    destinataire: string,
    objet: string,
    corps: string,
    pieceJointe?: PieceJointeEmail,
    classificationChoisie?: ResultatClassification
  ): Promise<AccuseEnvoiSmtp> {
    const { email, motDePasseApp } = await this.boiteMailDedieeService.obtenirIdentifiants(organisationId);

    const transporteur = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: false,
      // Refuse tout envoi, et toute authentification, sans STARTTLS réussi.
      requireTLS: true,
      connectionTimeout: DELAI_CONNEXION_MS,
      greetingTimeout: DELAI_ACCUEIL_MS,
      socketTimeout: DELAI_SOCKET_MS,
      dnsTimeout: DELAI_DNS_MS,
      auth: { user: email, pass: motDePasseApp }
    });

    let accuseServeur: { messageId?: string | undefined; response?: string | undefined };
    try {
      accuseServeur = await transporteur.sendMail({
        from: email,
        to: destinataire,
        subject: objet,
        text: corps,
        ...(pieceJointe && {
          attachments: [{ filename: pieceJointe.nomFichier, content: pieceJointe.contenu, contentType: pieceJointe.mimeType }]
        })
      });
    } catch (err) {
      // Codes seulement : jamais motDePasseApp (CLAUDE.md), ni le texte du
      // serveur, qui peut reprendre l'adresse de la boîte.
      const exception = new EnvoiSmtpEchoueException(err);
      this.logger.warn(
        `Échec SMTP (organisation ${organisationId}) : ${exception.categorie}, code ${exception.codeTechnique ?? "aucun"}, réponse ${exception.codeSmtp ?? "aucune"}`
      );
      throw exception;
    }

    const smtpMessageId = accuseServeur.messageId ?? null;
    let messageCommunicationId: string | null = null;
    try {
      messageCommunicationId = await this.journaliserEnvoi(
        organisationId,
        email,
        destinataire,
        objet,
        corps,
        pieceJointe,
        classificationChoisie
      );
    } catch (err) {
      this.logger.error(
        `Mail parti (${smtpMessageId ?? "identifiant inconnu"}) mais non journalisé pour l'organisation ${organisationId}`,
        err instanceof Error ? err.stack : String(err)
      );
    }

    return {
      expediteur: email,
      smtpMessageId,
      reponseServeur: accuseServeur.response ?? null,
      messageCommunicationId
    };
  }

  private async journaliserEnvoi(
    organisationId: string,
    email: string,
    destinataire: string,
    objet: string,
    corps: string,
    pieceJointe?: PieceJointeEmail,
    classificationChoisie?: ResultatClassification
  ): Promise<string> {
    const classification =
      classificationChoisie ?? (await this.classificationMessageService.resoudre(destinataire, organisationId));

    const [ligne] = await this.db
      .insert(messageCommunication)
      .values({
        direction: "envoye",
        objet,
        corpsTexte: corps,
        emailExpediteur: email,
        emailDestinataire: destinataire,
        dateMessage: new Date(),
        classificationType: classification.type,
        classificationId: classification.id,
        organisationId
      })
      .returning();
    if (!ligne) {
      throw new Error("Échec de la journalisation du message envoyé");
    }

    if (pieceJointe) {
      // Le message reste journalisé même si sa copie de pièce jointe échoue.
      try {
        await this.journaliserPieceJointe(ligne.id, organisationId, pieceJointe);
      } catch (err) {
        this.logger.error(
          `Pièce jointe non journalisée pour le message ${ligne.id}`,
          err instanceof Error ? err.stack : String(err)
        );
      }
    }

    return ligne.id;
  }

  private async journaliserPieceJointe(
    messageId: string,
    organisationId: string,
    pieceJointe: PieceJointeEmail
  ): Promise<void> {
    const pieceJointeId = uuidv7();
    const chemin = `messages/${messageId}/${pieceJointeId}.enc`;
    await this.documentStorageService.enregistrer(pieceJointe.contenu, chemin);
    await this.db.insert(pieceJointeMessage).values({
      id: pieceJointeId,
      messageId,
      nomFichier: pieceJointe.nomFichier,
      cheminStockage: chemin,
      typeMime: pieceJointe.mimeType,
      organisationId
    });
  }
}
