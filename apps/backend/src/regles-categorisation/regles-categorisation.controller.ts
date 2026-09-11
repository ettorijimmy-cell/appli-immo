import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { CreateRegleCategorisationDto } from "./dto/create-regle-categorisation.dto";
import { ReglesCategorisationService } from "./regles-categorisation.service";

@Controller("regles-categorisation")
export class ReglesCategorisationController {
  constructor(private readonly reglesCategorisationService: ReglesCategorisationService) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateRegleCategorisationDto) {
    return this.reglesCategorisationService.create(req.user!.sub, dto);
  }

  @Get()
  findAll() {
    return this.reglesCategorisationService.findAll();
  }

  @Patch(":id/archiver")
  archive(@Param("id") id: string) {
    return this.reglesCategorisationService.archive(id);
  }
}
