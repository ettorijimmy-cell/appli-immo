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
  UseGuards,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { DocumentsService, type FindAllDocumentsFiltres } from "./documents.service";
import { CreateDocumentDto, type DocumentCategorie, type DocumentEntiteType } from "./dto/create-document.dto";
import { UpdateDocumentDto } from "./dto/update-document.dto";

const TAILLE_MAX_OCTETS = 20 * 1024 * 1024;

@UseGuards(JwtAuthGuard)
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

  @Get()
  findAll(
    @Query("entiteType") entiteType?: DocumentEntiteType,
    @Query("entiteId") entiteId?: string,
    @Query("categorie") categorie?: DocumentCategorie,
    @Query("statut") statut?: "valide" | "expire" | "archive",
    @Query("recherche") recherche?: string,
    @Query("avecArchives") avecArchives?: string
  ) {
    const filtres: FindAllDocumentsFiltres = {
      ...(entiteType !== undefined && { entiteType }),
      ...(entiteId !== undefined && { entiteId }),
      ...(categorie !== undefined && { categorie }),
      ...(statut !== undefined && { statut }),
      ...(recherche !== undefined && { recherche }),
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
