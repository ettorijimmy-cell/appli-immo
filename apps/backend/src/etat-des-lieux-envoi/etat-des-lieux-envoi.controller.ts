import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { phaseValide } from "../etat-des-lieux-pdf/etat-des-lieux-pdf.controller";
import type { PhaseEtatDesLieux } from "../etat-des-lieux-pdf/etat-des-lieux-pdf.service";
import { EnvoyerEtatDesLieuxDto } from "./dto/envoyer-etat-des-lieux.dto";
import { EtatDesLieuxEnvoiService } from "./etat-des-lieux-envoi.service";

function phaseOuErreur(phase: string): PhaseEtatDesLieux {
  if (!phaseValide(phase)) {
    throw new BadRequestException("Phase invalide : 'entree' ou 'sortie' attendu.");
  }
  return phase;
}

// Protégé par le JwtAuthGuard global ; le service ajoute le contrôle
// d'organisation fail-closed sur chaque route.
@Controller("etats-des-lieux")
export class EtatDesLieuxEnvoiController {
  constructor(private readonly etatDesLieuxEnvoiService: EtatDesLieuxEnvoiService) {}

  @Get(":id/envois")
  lister(@Param("id") id: string) {
    return this.etatDesLieuxEnvoiService.listerHistorique(id);
  }

  @Get(":id/envois/:phase/destinataires")
  destinataires(@Param("id") id: string, @Param("phase") phase: string) {
    return this.etatDesLieuxEnvoiService.listerDestinataires(id, phaseOuErreur(phase));
  }

  // 200 même si un envoi échoue : le résultat se lit par destinataire.
  @Post(":id/envois/:phase")
  @HttpCode(200)
  envoyer(@Param("id") id: string, @Param("phase") phase: string, @Body() dto: EnvoyerEtatDesLieuxDto) {
    return this.etatDesLieuxEnvoiService.envoyer(id, phaseOuErreur(phase), dto);
  }
}
