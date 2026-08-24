import { Body, Controller, Get, Param, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CreateRemboursementDto } from "./dto/create-remboursement.dto";
import { RemboursementsService } from "./remboursements.service";

// Même limite que DocumentsController — pièce justificative de retenue
// (photo, devis), même ordre de grandeur qu'un document classique.
const TAILLE_MAX_OCTETS = 20 * 1024 * 1024;

@Controller("remboursements")
export class RemboursementsController {
  constructor(private readonly remboursementsService: RemboursementsService) {}

  // Fichier optionnel (contrairement à DocumentsController.upload) : la
  // grande majorité des remboursements (trop_percu, ou depot_garantie sans
  // retenue) n'en ont jamais — RemboursementsService.create() rejette les
  // combinaisons incohérentes (motif/fichier sans retenue réelle, ou
  // l'inverse).
  @Post()
  @UseInterceptors(FileInterceptor("pieceJustificative", { limits: { fileSize: TAILLE_MAX_OCTETS } }))
  create(@UploadedFile() fichier: Express.Multer.File | undefined, @Body() dto: CreateRemboursementDto) {
    return this.remboursementsService.create(dto, fichier);
  }

  @Get()
  findAll(@Query("bailId") bailId?: string) {
    return this.remboursementsService.findAll(bailId);
  }

  @Patch(":id/archiver")
  archive(@Param("id") id: string) {
    return this.remboursementsService.archive(id);
  }

  // Seul point d'accès au contenu en clair — voir CLAUDE.md, section Règles
  // importantes : jamais de déchiffrement côté apps/desktop.
  @Get(":id/piece-justificative")
  async telechargerPieceJustificative(@Param("id") id: string): Promise<StreamableFile> {
    const { contenu, nomFichier, mimeType } = await this.remboursementsService.telechargerPieceJustificative(id);
    return new StreamableFile(contenu, {
      type: mimeType,
      disposition: `attachment; filename="${encodeURIComponent(nomFichier)}"`
    });
  }
}
