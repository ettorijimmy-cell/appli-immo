import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { DocumentsService, type FindAllDocumentsFiltres } from "./documents.service";
import {
  CreateDocumentDto,
  type DocumentCandidatRole,
  type DocumentCategorie,
  type DocumentEntiteType
} from "./dto/create-document.dto";
import { RemplacerDocumentDto } from "./dto/remplacer-document.dto";
import { UpdateDocumentDto } from "./dto/update-document.dto";

const TAILLE_MAX_OCTETS = 20 * 1024 * 1024;

@Controller("documents")
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @UseInterceptors(FileInterceptor("fichier", { limits: { fileSize: TAILLE_MAX_OCTETS } }))
  upload(@UploadedFile() fichier: Express.Multer.File | undefined, @Body() dto: CreateDocumentDto) {
    if (!fichier) {
      throw new NotFoundException("Aucun fichier reçu");
    }
    return this.documentsService.upload(dto, fichier);
  }

  // Nouvelle version chaînée à documentPrecedentId (l':id de la route),
  // ancienne version archivée automatiquement — voir DocumentsService
  // .remplacerDocument(). Route dédiée plutôt qu'un flag sur POST /documents
  // : les deux créent une ligne, mais celle-ci en cascade une seconde
  // écriture (archivage) avec ses propres règles de rejet (409 si la
  // version ciblée n'est plus la version courante).
  @Post(":id/remplacer")
  @UseInterceptors(FileInterceptor("fichier", { limits: { fileSize: TAILLE_MAX_OCTETS } }))
  remplacer(
    @Param("id") id: string,
    @UploadedFile() fichier: Express.Multer.File | undefined,
    @Body() dto: RemplacerDocumentDto
  ) {
    if (!fichier) {
      throw new NotFoundException("Aucun fichier reçu");
    }
    return this.documentsService.remplacerDocument(id, dto, fichier);
  }

  @Get()
  findAll(
    @Query("entiteType") entiteType?: DocumentEntiteType,
    @Query("entiteId") entiteId?: string,
    @Query("categorie") categorie?: DocumentCategorie,
    @Query("statut") statut?: "valide" | "expire" | "archive",
    @Query("recherche") recherche?: string,
    @Query("avecArchives") avecArchives?: string,
    @Query("candidatRole") candidatRole?: DocumentCandidatRole
  ) {
    const filtres: FindAllDocumentsFiltres = {
      ...(entiteType !== undefined && { entiteType }),
      ...(entiteId !== undefined && { entiteId }),
      ...(categorie !== undefined && { categorie }),
      ...(statut !== undefined && { statut }),
      ...(recherche !== undefined && { recherche }),
      ...(candidatRole !== undefined && { candidatRole }),
      avecArchives: avecArchives === "true"
    };
    return this.documentsService.findAll(filtres);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.documentsService.findById(id);
  }

  // Seul point d'accès au contenu en clair — voir CLAUDE.md, section Règles
  // importantes : jamais de déchiffrement côté apps/desktop, jamais d'URL
  // publique directe sur le fichier stocké.
  @Get(":id/contenu")
  async telecharger(@Param("id") id: string): Promise<StreamableFile> {
    const { contenu, document } = await this.documentsService.telecharger(id);
    return new StreamableFile(contenu, {
      type: document.mimeType,
      disposition: `attachment; filename="${encodeURIComponent(document.nomFichier)}"`
    });
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateDocumentDto) {
    return this.documentsService.update(id, dto);
  }

  @Patch(":id/archiver")
  archiver(@Param("id") id: string) {
    return this.documentsService.archiver(id);
  }
}
