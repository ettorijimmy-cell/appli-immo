import { BadRequestException, Controller, Get, HttpCode, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { EtatDesLieuxPdfService, type PhaseEtatDesLieux } from "./etat-des-lieux-pdf.service";

const MIME_PDF = "application/pdf";

function phaseValide(phase: string): phase is PhaseEtatDesLieux {
  return phase === "entree" || phase === "sortie";
}

@Controller("etats-des-lieux")
export class EtatDesLieuxPdfController {
  constructor(private readonly etatDesLieuxPdfService: EtatDesLieuxPdfService) {}

  // Bouton "Produire le PDF" (desktop) : idempotent, ne produit que ce qui
  // manque. 204 (rien à renvoyer — le client relit via GET :id/pdf).
  // produireManuellement traduit elle-même tout échec attendu (signature
  // illisible, Gotenberg absent/en panne/en échec) en exception HTTP
  // française compréhensible — rien à traduire ici, jamais de try/catch
  // dans ce contrôleur (voir EtatDesLieuxPdfService.traduireEchecProductionEnHttp).
  @Post(":id/pdf/:phase")
  @HttpCode(204)
  async produire(@Param("id") id: string, @Param("phase") phase: string): Promise<void> {
    if (!phaseValide(phase)) {
      throw new BadRequestException("Phase invalide : 'entree' ou 'sortie' attendu.");
    }
    await this.etatDesLieuxPdfService.produireManuellement(id, phase);
  }

  @Get(":id/pdf")
  lister(@Param("id") id: string) {
    return this.etatDesLieuxPdfService.listerDocumentsFiges(id);
  }

  @Get(":id/pdf/:phase/contenu")
  async telecharger(@Param("id") id: string, @Param("phase") phase: string, @Res() res: Response): Promise<void> {
    if (!phaseValide(phase)) {
      throw new BadRequestException("Phase invalide : 'entree' ou 'sortie' attendu.");
    }
    const { contenu, nomFichier } = await this.etatDesLieuxPdfService.telechargerPdf(id, phase);
    res.set({
      "Content-Type": MIME_PDF,
      "Content-Disposition": `attachment; filename="${nomFichier}"`
    });
    res.send(contenu);
  }
}
