import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { TAILLE_MAX_SCAN_ENTREE_PAPIER_OCTETS } from "core";
import { DeclarerEntreePapierDto } from "./dto/declarer-entree-papier.dto";
import { EtatDesLieuxEntreePapierService } from "./etat-des-lieux-entree-papier.service";

@Controller("etats-des-lieux")
export class EtatDesLieuxEntreePapierController {
  constructor(private readonly entreePapierService: EtatDesLieuxEntreePapierService) {}

  // Déclaration ou correction (multipart : champs texte + fichier "scan").
  // Le scan est obligatoire pour la première déclaration, facultatif pour
  // une correction (sans lui, le scan de la déclaration active est repris).
  // Le plafond multer coupe un envoi trop gros avant de le lire en entier ;
  // le service refait le contrôle avec un message en français.
  @Post(":id/entree-papier")
  @UseInterceptors(FileInterceptor("scan", { limits: { fileSize: TAILLE_MAX_SCAN_ENTREE_PAPIER_OCTETS + 1 } }))
  declarer(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: DeclarerEntreePapierDto,
    @UploadedFile() fichier?: Express.Multer.File
  ) {
    return this.entreePapierService.declarer(
      id,
      dto,
      fichier ? { nomFichier: fichier.originalname, contenu: fichier.buffer } : undefined
    );
  }

  // Historique des déclarations (la active comprise), la plus récente en premier.
  @Get(":id/entree-papier")
  historique(@Param("id", ParseUUIDPipe) id: string) {
    return this.entreePapierService.historique(id);
  }
}
