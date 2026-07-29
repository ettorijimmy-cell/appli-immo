import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { DerniereSauvegardeService } from "./derniere-sauvegarde.service";
import { PeriodeQueryDto } from "./dto/periode-query.dto";
import { TableauDeBordService } from "./tableau-de-bord.service";

@UseGuards(JwtAuthGuard)
@Controller("tableau-de-bord")
export class TableauDeBordController {
  constructor(
    private readonly tableauDeBordService: TableauDeBordService,
    private readonly derniereSauvegardeService: DerniereSauvegardeService
  ) {}

  @Get("derniere-sauvegarde")
  getDerniereSauvegarde() {
    return this.derniereSauvegardeService.getDerniereSauvegarde();
  }

  @Get("en-tete")
  getEnTete() {
    return this.tableauDeBordService.getEnTete();
  }

  @Get("cartes")
  getCartes() {
    return this.tableauDeBordService.getCartes();
  }

  @Get("revenus-locatifs")
  getRevenusLocatifs(@Query() query: PeriodeQueryDto) {
    return this.tableauDeBordService.getRevenusLocatifs(query.debut, query.fin);
  }

  @Get("synthese")
  getSynthese(@Query() query: PeriodeQueryDto) {
    return this.tableauDeBordService.getSynthese(query.debut, query.fin);
  }
}
