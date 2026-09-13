import { Controller, Get, NotFoundException, Param, Res } from "@nestjs/common";
import { genererIcs } from "core";
import type { Response } from "express";
import { Public } from "../auth/public.decorator";
import { EvenementsCalendrierService } from "../evenements-calendrier/evenements-calendrier.service";
import { CalendrierAbonnementService } from "./calendrier-abonnement.service";

const MIME_ICS = "text/calendar; charset=utf-8";

// @Public() : une application calendrier (téléphone) ne peut pas fournir
// de Bearer JWT — la sécurité repose entièrement sur le jeton, long et
// aléatoire, contenu dans l'URL (voir CalendrierAbonnementService). Un
// jeton invalide ou inexistant renvoie toujours le même 404 générique,
// jamais un message qui permettrait de distinguer "ce jeton n'existe pas"
// de "cette route existe mais le jeton est mauvais".
@Controller("calendrier")
export class CalendrierIcsController {
  constructor(
    private readonly calendrierAbonnementService: CalendrierAbonnementService,
    private readonly evenementsCalendrierService: EvenementsCalendrierService
  ) {}

  @Public()
  @Get("ics/:jeton")
  async telechargerIcs(@Param("jeton") jeton: string, @Res() res: Response): Promise<void> {
    const organisationId = await this.calendrierAbonnementService.trouverOrganisationParJeton(jeton);
    if (!organisationId) {
      throw new NotFoundException("Introuvable");
    }

    const evenements = await this.evenementsCalendrierService.findAllPourOrganisation(organisationId);
    const ics = genererIcs(
      evenements.map((evenement) => ({
        id: evenement.id,
        titre: evenement.titre,
        dateDebut: evenement.dateDebut,
        dateFin: evenement.dateFin,
        notes: evenement.notes
      }))
    );

    res.set({ "Content-Type": MIME_ICS });
    res.send(ics);
  }
}
