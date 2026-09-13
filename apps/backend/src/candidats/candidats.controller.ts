import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { CandidatsService } from "./candidats.service";
import { CreateCandidatDto } from "./dto/create-candidat.dto";
import { UpdateCandidatDto } from "./dto/update-candidat.dto";

@Controller("candidats")
export class CandidatsController {
  constructor(private readonly candidatsService: CandidatsService) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateCandidatDto) {
    return this.candidatsService.create(req.user!.sub, dto);
  }

  @Get()
  findAll() {
    return this.candidatsService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.candidatsService.findById(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateCandidatDto) {
    return this.candidatsService.update(id, dto);
  }

  @Patch(":id/archiver")
  archive(@Param("id") id: string) {
    return this.candidatsService.archive(id);
  }

  @Post(":id/convertir")
  convertir(@Req() req: Request, @Param("id") id: string) {
    return this.candidatsService.convertirEnLocataire(req.user!.sub, id);
  }
}
