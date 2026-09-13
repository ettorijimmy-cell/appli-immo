import { Controller, Get, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { CalendrierAbonnementService } from "./calendrier-abonnement.service";

// Protégé par le JwtAuthGuard global (pas de @Public() ici) — seul un
// gestionnaire authentifié peut consulter ou régénérer le jeton
// d'abonnement de son organisation. Le flux ICS public lui-même vit dans
// CalendrierIcsController.
@Controller("calendrier-abonnement")
export class CalendrierAbonnementController {
  constructor(private readonly calendrierAbonnementService: CalendrierAbonnementService) {}

  @Get()
  obtenir(@Req() req: Request) {
    return this.calendrierAbonnementService.obtenirPourUtilisateur(req.user!.sub);
  }

  @Post("regenerer")
  regenerer(@Req() req: Request) {
    return this.calendrierAbonnementService.genererOuRegenererJeton(req.user!.sub);
  }
}
