import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { DeclarerRemiseBailDto } from "./dto/declarer-remise-bail.dto";
import { SuiviCautionService } from "./suivi-caution.service";

// Suivi d'une caution personne physique (chantier garants, commit 6). 404
// pour un garant d'une autre organisation, 400 pour une garantie Visale.
@Controller("garants")
export class SuiviCautionController {
  constructor(private readonly suiviCautionService: SuiviCautionService) {}

  // Déclaration de la remise du bail à la caution, ou sa correction quand
  // une déclaration active existe (archivée, puis remplacée).
  @Post(":id/remise-bail")
  declarerRemiseBail(@Param("id", ParseUUIDPipe) id: string, @Body() dto: DeclarerRemiseBailDto) {
    return this.suiviCautionService.declarerRemiseBail(id, dto);
  }

  // Déclaration active et historique des corrections.
  @Get(":id/remise-bail")
  consulterRemiseBail(@Param("id", ParseUUIDPipe) id: string) {
    return this.suiviCautionService.consulterRemiseBail(id);
  }

  // Fin d'engagement de la caution (même date que l'acte) et, en
  // colocation, les dates de l'art. 8-1, VI.
  @Get(":id/engagement")
  consulterEngagement(@Param("id", ParseUUIDPipe) id: string) {
    return this.suiviCautionService.consulterEngagement(id);
  }
}
