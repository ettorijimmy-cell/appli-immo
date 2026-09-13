import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { CreateLocataireDto } from "./dto/create-locataire.dto";
import { UpdateLocataireDto } from "./dto/update-locataire.dto";
import { LocatairesService } from "./locataires.service";

@Controller("locataires")
export class LocatairesController {
  constructor(private readonly locatairesService: LocatairesService) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateLocataireDto) {
    return this.locatairesService.create(req.user!.sub, dto);
  }

  @Get()
  findAll() {
    return this.locatairesService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.locatairesService.findById(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateLocataireDto) {
    return this.locatairesService.update(id, dto);
  }

  @Patch(":id/archiver")
  archive(@Param("id") id: string) {
    return this.locatairesService.archive(id);
  }
}
