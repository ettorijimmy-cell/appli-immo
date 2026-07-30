import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CreatePaiementDto } from "./dto/create-paiement.dto";
import { RapprocherCsvDto } from "./dto/rapprocher-csv.dto";
import { UpdatePaiementDto } from "./dto/update-paiement.dto";
import { PaiementsService } from "./paiements.service";

@UseGuards(JwtAuthGuard)
@Controller("paiements")
export class PaiementsController {
  constructor(private readonly paiementsService: PaiementsService) {}

  @Post()
  create(@Body() dto: CreatePaiementDto) {
    return this.paiementsService.create(dto);
  }

  @Post("rapprocher-csv")
  rapprocherCsv(@Body() dto: RapprocherCsvDto) {
    return this.paiementsService.rapprocherCsv(dto);
  }

  @Get()
  findAll(@Query("bailId") bailId?: string) {
    return this.paiementsService.findAll(bailId);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.paiementsService.findById(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdatePaiementDto) {
    return this.paiementsService.update(id, dto);
  }

  @Patch(":id/archiver")
  archive(@Param("id") id: string) {
    return this.paiementsService.archive(id);
  }
}
