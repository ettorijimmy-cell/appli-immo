import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { CreateEvenementCalendrierDto, type EvenementType } from "./dto/create-evenement-calendrier.dto";
import { UpdateEvenementCalendrierDto } from "./dto/update-evenement-calendrier.dto";
import { EvenementsCalendrierService, type FindAllEvenementsFiltres } from "./evenements-calendrier.service";

@Controller("evenements-calendrier")
export class EvenementsCalendrierController {
  constructor(private readonly evenementsCalendrierService: EvenementsCalendrierService) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateEvenementCalendrierDto) {
    return this.evenementsCalendrierService.create(req.user!.sub, dto);
  }

  @Get()
  findAll(
    @Query("periodeDebut") periodeDebut?: string,
    @Query("periodeFin") periodeFin?: string,
    @Query("type") type?: EvenementType
  ) {
    const filtres: FindAllEvenementsFiltres = {
      ...(periodeDebut !== undefined && { periodeDebut }),
      ...(periodeFin !== undefined && { periodeFin }),
      ...(type !== undefined && { type })
    };
    return this.evenementsCalendrierService.findAll(filtres);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.evenementsCalendrierService.findById(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateEvenementCalendrierDto) {
    return this.evenementsCalendrierService.update(id, dto);
  }

  @Patch(":id/archiver")
  archive(@Param("id") id: string) {
    return this.evenementsCalendrierService.archive(id);
  }
}
