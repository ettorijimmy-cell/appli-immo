import { Body, Controller, Get, Param, Post, Query, Req, StreamableFile } from "@nestjs/common";
import type { Request } from "express";
import { BoiteMailDedieeService } from "./boite-mail-dediee.service";
import { CreateDocumentDto } from "../documents/dto/create-document.dto";
import { ComposerMessageDto } from "./dto/composer-message.dto";
import { ConfigurerBoiteMailDedieeDto } from "./dto/configurer-boite-mail-dediee.dto";
import { ImapSyncJobService } from "./imap-sync-job.service";
import { MessagesCommunicationService, type FindAllMessagesFiltres } from "./messages-communication.service";

@Controller("messagerie")
export class MessagerieController {
  constructor(
    private readonly boiteMailDedieeService: BoiteMailDedieeService,
    private readonly messagesCommunicationService: MessagesCommunicationService,
    private readonly imapSyncJobService: ImapSyncJobService
  ) {}

  @Post("boite-mail")
  configurerBoiteMail(@Req() req: Request, @Body() dto: ConfigurerBoiteMailDedieeDto) {
    return this.boiteMailDedieeService.configurer(req.user!.sub, dto);
  }

  @Get("boite-mail/statut")
  statutBoiteMail(@Req() req: Request) {
    return this.boiteMailDedieeService.obtenirStatut(req.user!.sub);
  }

  @Get("messages")
  findAllMessages(
    @Query("classificationType") classificationType?: FindAllMessagesFiltres["classificationType"],
    @Query("classificationId") classificationId?: string
  ) {
    const filtres: FindAllMessagesFiltres = {
      ...(classificationType !== undefined && { classificationType }),
      ...(classificationId !== undefined && { classificationId })
    };
    return this.messagesCommunicationService.findAll(filtres);
  }

  @Get("messages/:id")
  findOneMessage(@Param("id") id: string) {
    return this.messagesCommunicationService.findById(id);
  }

  @Post("messages/composer")
  composer(@Req() req: Request, @Body() dto: ComposerMessageDto) {
    return this.messagesCommunicationService.composer(req.user!.sub, dto);
  }

  // Seul point d'accès au contenu en clair d'une pièce jointe — jamais de
  // déchiffrement côté apps/desktop, même principe que
  // DocumentsController.telecharger (CLAUDE.md).
  @Get("pieces-jointes/:id/contenu")
  async telechargerPieceJointe(@Param("id") id: string): Promise<StreamableFile> {
    const { contenu, nomFichier, typeMime } = await this.messagesCommunicationService.obtenirContenuPieceJointe(id);
    return new StreamableFile(contenu, {
      ...(typeMime && { type: typeMime }),
      disposition: `attachment; filename="${encodeURIComponent(nomFichier)}"`
    });
  }

  // Action manuelle "Classer dans Documents" — jamais automatique
  // (décision actée avec Jimmy, voir packages/db/src/schema/
  // message-communication.ts).
  @Post("pieces-jointes/:id/classer-dans-documents")
  classerDansDocuments(@Param("id") id: string, @Body() dto: CreateDocumentDto) {
    return this.messagesCommunicationService.classerDansDocuments(id, dto);
  }

  // Déclenchement manuel du job périodique (même code que le @Cron réel) —
  // même principe que executerJobAlertes/executerJobTaches, pour vérifier
  // le comportement sans attendre la prochaine exécution planifiée.
  @Post("executer-job-sync")
  executerJobSync() {
    return this.imapSyncJobService.synchroniserToutesLesBoites();
  }
}
