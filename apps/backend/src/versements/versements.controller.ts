import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CreateVersementDto } from "./dto/create-versement.dto";
import { VersementsService } from "./versements.service";

@UseGuards(JwtAuthGuard)
@Controller("versements")
export class VersementsController {
  constructor(private readonly versementsService: VersementsService) {}

  @Post()
  ajouter(@Body() dto: CreateVersementDto) {
    return this.versementsService.ajouter(dto);
  }

  @Get()
  findAll(@Query("paiementId") paiementId?: string) {
    return this.versementsService.findAll(paiementId);
  }

  @Patch(":id/annuler")
  annuler(@Param("id") id: string) {
    return this.versementsService.annuler(id);
  }
}
