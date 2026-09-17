import { BadGatewayException, Inject, Injectable } from "@nestjs/common";
import { messageCommunication, pieceJointeMessage, type Database } from "db";
import type { ResultatClassification } from "core";
import { uuidv7 } from "uuidv7";
import nodemailer from "nodemailer";
import { DATABASE_CONNECTION } from "../database/database.module";
import { DocumentStorageService } from "../storage/document-storage.service";
import { BoiteMailDedieeService } from "./boite-mail-dediee.service";
import { ClassificationMessageService } from "./classification-message.service";

// Gmail SMTP (mot de passe d'application, PAS OAuth — voir
// packages/db/src/schema/boite-mail-dediee.ts pour la décision technique).
const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465;

export interface PieceJointeEmail {
  nomFichier: string;
  contenu: Buffer;
  mimeType: string;
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
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly boiteMailDedieeService: BoiteMailDedieeService,
    private readonly classificationMessageService: ClassificationMessageService,
    private readonly documentStorageService: DocumentStorageService
  ) {}

  // Renvoie l'id du message_communication journalisé — jamais lu par
  // TachesService.envoyerNotification (seul appelant historique, qui
  // ignore la valeur de retour), utilisé uniquement par
  // MessagesCommunicationService.composer() pour renvoyer le message créé.
  //
  // classificationChoisie (optionnel) : classification déjà connue de
  // l'appelant (destinataire choisi depuis le Carnet de contacts,
  // sélecteur desktop 2026-09-16) — bypass la résolution par adresse email
  // (ClassificationMessageService.resoudre), jamais utilisée en même
  // temps que cette résolution automatique.
  async envoyerEmail(
    organisationId: string,
    destinataire: string,
    objet: string,
    corps: string,
    pieceJointe?: PieceJointeEmail,
    classificationChoisie?: ResultatClassification
  ): Promise<string> {
    const { email, motDePasseApp } = await this.boiteMailDedieeService.obtenirIdentifiants(organisationId);

    const transporteur = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: true,
      auth: { user: email, pass: motDePasseApp }
    });

    try {
      await transporteur.sendMail({
        from: email,
        to: destinataire,
        subject: objet,
        text: corps,
        ...(pieceJointe && {
          attachments: [{ filename: pieceJointe.nomFichier, content: pieceJointe.contenu, contentType: pieceJointe.mimeType }]
        })
      });
    } catch (err) {
      // Jamais motDePasseApp dans ce message (CLAUDE.md) — seul le message
      // d'erreur SMTP lui-même, qui ne contient aucun secret.
      const messageErreur = err instanceof Error ? err.message : String(err);
      throw new BadGatewayException(`Échec de l'envoi via la boîte mail dédiée (SMTP) : ${messageErreur}`);
    }

    return this.journaliserEnvoi(organisationId, email, destinataire, objet, corps, pieceJointe, classificationChoisie);
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
        corps,
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
      const pieceJointeId = uuidv7();
      const chemin = `messages/${ligne.id}/${pieceJointeId}.enc`;
      await this.documentStorageService.enregistrer(pieceJointe.contenu, chemin);
      await this.db.insert(pieceJointeMessage).values({
        id: pieceJointeId,
        messageId: ligne.id,
        nomFichier: pieceJointe.nomFichier,
        cheminStockage: chemin,
        typeMime: pieceJointe.mimeType,
        organisationId
      });
    }

    return ligne.id;
  }
}
