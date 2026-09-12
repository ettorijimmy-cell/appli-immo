import { BadRequestException, Body, Controller, Get, Param, Patch, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { Annexe1QueryDto } from "./dto/annexe1-query.dto";
import { SaisieManuelleAnnexe1Dto } from "./dto/saisie-manuelle-annexe1.dto";
import { FiscaliteService } from "./fiscalite.service";

@Controller("fiscalite")
export class FiscaliteController {
  constructor(private readonly fiscaliteService: FiscaliteService) {}

  @Get("annexe1")
  calculerAnnexe1(@Req() req: Request, @Query() query: Annexe1QueryDto) {
    return this.fiscaliteService.calculerAnnexe1PourSci(req.user!.sub, query.sciId, query.annee);
  }

  @Patch("annexe1/:bienId/:annee")
  sauvegarderSaisieManuelle(
    @Req() req: Request,
    @Param("bienId") bienId: string,
    @Param("annee") annee: string,
    @Body() dto: SaisieManuelleAnnexe1Dto
  ) {
    // :annee est un @Param brut (pas de DTO possible sur un segment
    // d'URL) — validé ici plutôt que de laisser Number("abc") = NaN
    // atteindre une contrainte entière Postgres avec un message opaque.
    const anneeValidee = Number(annee);
    if (!Number.isInteger(anneeValidee)) {
      throw new BadRequestException("annee doit être un entier");
    }
    return this.fiscaliteService.sauvegarderSaisieManuelle(req.user!.sub, bienId, anneeValidee, dto);
  }
}
