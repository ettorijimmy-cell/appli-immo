import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { messageCommunication, mettreAJourAvecAudit, pieceJointeMessage, type Database } from "db";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { CreateDocumentDto } from "../documents/dto/create-document.dto";
import { DocumentsService } from "../documents/documents.service";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { DocumentStorageService } from "../storage/document-storage.service";
import { UsersService } from "../users/users.service";
import type { ComposerMessageDto } from "./dto/composer-message.dto";
import { SmtpEnvoiService } from "./smtp-envoi.service";

export interface FindAllMessagesFiltres {
  classificationType?: "contact" | "locataire" | "candidat" | "garant" | "non_classe";
  classificationId?: string;
  // Même convention que FindAllDocumentsFiltres.avecArchives
  // (documents.service.ts) : absent/false = comportement par défaut
  // inchangé (archivés exclus), true = levé — jamais l'inverse.
  avecArchives?: boolean;
}

type MessageCommunicationRow = typeof messageCommunication.$inferSelect;
type PieceJointeMessageRow = typeof pieceJointeMessage.$inferSelect;

/**
 * Module Messagerie (2026-09-16). Fils groupés côté frontend par
 * (classificationType, classificationId) — cette couche reste un CRUD/
 * lecture simple sur les lignes déjà journalisées par SmtpEnvoiService
 * (envoyés) et ImapSyncJobService (reçus), plus l'action manuelle
 * "Classer dans Documents".
 */
@Injectable()
export class MessagesCommunicationService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService,
    private readonly usersService: UsersService,
    private readonly smtpEnvoiService: SmtpEnvoiService,
    private readonly documentsService: DocumentsService,
    private readonly documentStorageService: DocumentStorageService
  ) {}

  async findAll(filtres: FindAllMessagesFiltres) {
    const conditions = [];
    // Mécanisme centralisé (Commit 2, docs/data-dictionary.md) : lu
    // directement depuis le JWT décodé, jamais un lookup UsersService.
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      conditions.push(eq(messageCommunication.organisationId, organisationId));
    }
    if (filtres.classificationType) {
      conditions.push(eq(messageCommunication.classificationType, filtres.classificationType));
    }
    if (filtres.classificationId) {
      conditions.push(eq(messageCommunication.classificationId, filtres.classificationId));
    }
    // Un message archivé (action manuelle "Archiver", jamais une action sur
    // la vraie boîte Gmail) ne réapparaît plus dans la liste par défaut —
    // avecArchives lève ce filtre pour la vue "Afficher les archivés"
    // (2026-09-17), même mécanique que FindAllDocumentsFiltres.avecArchives.
    if (!filtres.avecArchives) {
      conditions.push(isNull(messageCommunication.archivedAt));
    }
    const lignes = await this.db
      .select()
      .from(messageCommunication)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(messageCommunication.dateMessage));
    return lignes.map((ligne) => this.versDto(ligne));
  }

  // Contrôle d'appartenance (Sous-commit 5a, chantier scoping
  // multi-organisation, 2026-09-18) : même message que "n'existe pas",
  // aucune différence observable — même principe que B1-B6. Skip si
  // organisationId absent (hors contexte HTTP). Appelé en interne par
  // composer() ci-dessous (this.findById(messageId)) — sans impact : le
  // message vient d'être créé avec l'organisationId de l'utilisateur
  // courant, donc toujours dans l'organisation de l'appelant. Réutilise
  // désormais resoudreMessageAvecAppartenance() (Priorité 3a, 2026-09-19),
  // partagée avec archiver()/desarchiver() ci-dessous.
  async findById(id: string) {
    const ligne = await this.resoudreMessageAvecAppartenance(id);
    const piecesJointes = await this.db
      .select()
      .from(pieceJointeMessage)
      .where(eq(pieceJointeMessage.messageId, id));
    return { ...this.versDto(ligne), piecesJointes: piecesJointes.map((p) => this.versDtoPieceJointe(p)) };
  }

  // Composition libre hors du flux Tâches — délègue entièrement à
  // SmtpEnvoiService (même mécanisme d'envoi/journalisation que les
  // notifications automatiques), jamais un chemin d'envoi dupliqué.
  // classificationType/classificationId (destinataire choisi depuis le
  // Carnet de contacts, sélecteur desktop 2026-09-16) doivent être fournis
  // ensemble ou pas du tout — ComposerMessageDto ne peut pas exprimer
  // cette contrainte croisée avec class-validator seul, vérifiée ici.
  async composer(userId: string, dto: ComposerMessageDto) {
    if (
      (dto.classificationType !== undefined && dto.classificationId === undefined) ||
      (dto.classificationType === undefined && dto.classificationId !== undefined)
    ) {
      throw new BadRequestException("classificationType et classificationId doivent être fournis ensemble");
    }
    const utilisateur = await this.usersService.findById(userId);
    if (!utilisateur) {
      throw new NotFoundException("Utilisateur introuvable");
    }
    const messageId = await this.smtpEnvoiService.envoyerEmail(
      utilisateur.organisationId,
      dto.destinataire,
      dto.objet,
      dto.corps,
      undefined,
      dto.classificationType !== undefined && dto.classificationId !== undefined
        ? { type: dto.classificationType, id: dto.classificationId }
        : undefined
    );
    return this.findById(messageId);
  }

  // Archivage à l'unité du message — jamais un fil entier, même discipline
  // que contact.archive()/candidat.archive() (toujours l'unité la plus
  // fine). Masque uniquement côté app : jamais un appel IMAP, le vrai
  // email reste intact sur la boîte Gmail (décision actée avec Jimmy,
  // suppression réelle côté Gmail explicitement hors périmètre).
  async archiver(id: string) {
    // Contrôle d'appartenance AVANT toute écriture (Priorité 3a, Catégorie C,
    // chantier scoping multi-organisation, 2026-09-19).
    await this.resoudreMessageAvecAppartenance(id);

    const [ligne] = await mettreAJourAvecAudit(
      this.db,
      messageCommunication,
      id,
      { archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!ligne) {
      throw new NotFoundException("Message introuvable");
    }
    return this.versDto(ligne as MessageCommunicationRow);
  }

  // Symétrique d'archiver() (2026-09-17) — première action de
  // "désarchivage" du codebase, aucun autre module (contact/candidat/
  // locataire/...) n'en propose. Retire archivedAt, le message redevient
  // visible par défaut dans findAll() sans avecArchives.
  async desarchiver(id: string) {
    // Contrôle d'appartenance AVANT toute écriture (Priorité 3a, Catégorie C,
    // chantier scoping multi-organisation, 2026-09-19).
    await this.resoudreMessageAvecAppartenance(id);

    const [ligne] = await mettreAJourAvecAudit(
      this.db,
      messageCommunication,
      id,
      { archivedAt: null },
      this.requestContext.getUtilisateurId()
    );
    if (!ligne) {
      throw new NotFoundException("Message introuvable");
    }
    return this.versDto(ligne as MessageCommunicationRow);
  }

  // Contenu déchiffré d'une pièce jointe — jamais mis en cache côté
  // serveur, relu depuis le storage à chaque appel (même principe que
  // DocumentsService, cf. téléchargement de document). Contrôle
  // d'appartenance ajouté en Priorité 3a (2026-09-19), réutilisant
  // resoudrePieceJointeAvecAppartenance() (Priorité 2) — cette méthode avait
  // été signalée comme lacune restante sans être corrigée à l'époque ; sa
  // correction étant triviale (même helper déjà en place), incluse ici
  // plutôt que reportée à nouveau.
  async obtenirContenuPieceJointe(pieceJointeId: string) {
    const piece = await this.resoudrePieceJointeAvecAppartenance(pieceJointeId);
    const contenu = await this.documentStorageService.lire(piece.cheminStockage);
    return { contenu, nomFichier: piece.nomFichier, typeMime: piece.typeMime };
  }

  // Action manuelle "Classer dans Documents" (jamais automatique, décision
  // actée avec Jimmy) : copie le contenu déjà stocké de la pièce jointe
  // vers le système `documents` polymorphe, sous une vraie catégorie et un
  // rattachement choisis par l'utilisateur — jamais un partage de
  // cheminStockage entre les deux tables (les deux copies vivent leur vie
  // indépendamment, ex. si le message est un jour purgé).
  async classerDansDocuments(pieceJointeId: string, dto: CreateDocumentDto) {
    // Contrôle d'appartenance AVANT tout déchiffrement et avant l'appel à
    // documentsService.creerDepuisBuffer (Priorité 2, Catégorie C, chantier
    // scoping multi-organisation, 2026-09-19) : sans lui, une pièceJointeId
    // d'une autre organisation menait à déchiffrer son contenu et à créer un
    // vrai document dans le système polymorphe à partir de celui-ci.
    // dto.entiteType/dto.entiteId ne sont volontairement pas revérifiés ici
    // (verifierEntiteExiste, appelé par creerDepuisBuffer, ne contrôle pas
    // l'organisation — Catégorie E, hors périmètre de ce commit).
    const piece = await this.resoudrePieceJointeAvecAppartenance(pieceJointeId);
    const contenu = await this.documentStorageService.lire(piece.cheminStockage);
    return this.documentsService.creerDepuisBuffer(
      dto,
      contenu,
      piece.nomFichier,
      piece.typeMime ?? "application/octet-stream",
      contenu.byteLength
    );
  }

  // Contrôle d'appartenance (Priorité 2, Catégorie C, chantier scoping
  // multi-organisation, 2026-09-19) : organisationId est une colonne
  // directe sur pieceJointeMessage (dénormalisée depuis son message parent
  // à la création, voir packages/db/src/schema/message-communication.ts) —
  // contrôle par simple comparaison, même principe que Catégorie A. Même
  // message que "n'existe pas", aucune différence observable. Skip si
  // organisationId absent (hors contexte HTTP). Utilisé par
  // classerDansDocuments() et, depuis Priorité 3a, obtenirContenuPieceJointe()
  // ci-dessus.
  private async resoudrePieceJointeAvecAppartenance(pieceJointeId: string): Promise<PieceJointeMessageRow> {
    const [piece] = await this.db
      .select()
      .from(pieceJointeMessage)
      .where(eq(pieceJointeMessage.id, pieceJointeId))
      .limit(1);
    const organisationId = this.requestContext.getOrganisationId();
    if (!piece || (organisationId && piece.organisationId !== organisationId)) {
      throw new NotFoundException("Pièce jointe introuvable");
    }
    return piece;
  }

  // Contrôle d'appartenance partagé (Sous-commit 5a pour findById(), étendu
  // en Priorité 3a/Catégorie C à archiver()/desarchiver() — 2026-09-19) :
  // même message que "n'existe pas", aucune différence observable. Skip si
  // organisationId absent (hors contexte HTTP).
  private async resoudreMessageAvecAppartenance(id: string): Promise<MessageCommunicationRow> {
    const [ligne] = await this.db.select().from(messageCommunication).where(eq(messageCommunication.id, id)).limit(1);
    const organisationId = this.requestContext.getOrganisationId();
    if (!ligne || (organisationId && ligne.organisationId !== organisationId)) {
      throw new NotFoundException("Message introuvable");
    }
    return ligne;
  }

  private versDto(ligne: MessageCommunicationRow) {
    return {
      id: ligne.id,
      createdAt: ligne.createdAt,
      updatedAt: ligne.updatedAt,
      updatedBy: ligne.updatedBy,
      version: ligne.version,
      archivedAt: ligne.archivedAt,
      direction: ligne.direction,
      objet: ligne.objet,
      corpsTexte: ligne.corpsTexte,
      corpsHtml: ligne.corpsHtml,
      emailExpediteur: ligne.emailExpediteur,
      emailDestinataire: ligne.emailDestinataire,
      dateMessage: ligne.dateMessage,
      classificationType: ligne.classificationType,
      classificationId: ligne.classificationId,
      organisationId: ligne.organisationId
    };
  }

  private versDtoPieceJointe(piece: PieceJointeMessageRow) {
    return {
      id: piece.id,
      messageId: piece.messageId,
      nomFichier: piece.nomFichier,
      typeMime: piece.typeMime
    };
  }
}
