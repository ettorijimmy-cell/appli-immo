import {
  BadGatewayException,
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  ServiceUnavailableException
} from "@nestjs/common";
import type { Response } from "express";
import { GotenbergConversionError, GotenbergIndisponibleError } from "../gotenberg/gotenberg.errors";
import { EtatDesLieuxPdfService, type PhaseEtatDesLieux } from "./etat-des-lieux-pdf.service";

const MIME_PDF = "application/pdf";

function phaseValide(phase: string): phase is PhaseEtatDesLieux {
  return phase === "entree" || phase === "sortie";
}

// Traduit les erreurs plates de GotenbergService (jamais des exceptions
// NestJS — voir gotenberg.errors.ts) en réponses HTTP, uniquement ici, au
// bord de l'application : 503 pour une situation transitoire (le client
// peut réessayer plus tard, ou attendre la relance automatique), 502 pour
// un échec qui rejouerait identiquement.
function relancerCommeExceptionHttp(erreur: unknown): never {
  if (erreur instanceof GotenbergIndisponibleError) {
    throw new ServiceUnavailableException(erreur.message);
  }
  if (erreur instanceof GotenbergConversionError) {
    throw new BadGatewayException(erreur.message);
  }
  throw erreur;
}

@Controller("etats-des-lieux")
export class EtatDesLieuxPdfController {
  constructor(private readonly etatDesLieuxPdfService: EtatDesLieuxPdfService) {}

  // Bouton "Produire le PDF" (desktop) : idempotent, ne produit que ce qui
  // manque. 204 (rien à renvoyer — le client relit via GET :id/pdf).
  @Post(":id/pdf/:phase")
  @HttpCode(204)
  async produire(@Param("id") id: string, @Param("phase") phase: string): Promise<void> {
    if (!phaseValide(phase)) {
      throw new BadRequestException("Phase invalide : 'entree' ou 'sortie' attendu.");
    }
    try {
      await this.etatDesLieuxPdfService.produireManuellement(id, phase);
    } catch (erreur) {
      relancerCommeExceptionHttp(erreur);
    }
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
