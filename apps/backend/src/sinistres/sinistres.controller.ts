import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { CreateSinistreDto } from "./dto/create-sinistre.dto";
import { UpdateSinistreDto } from "./dto/update-sinistre.dto";
import { SinistresService } from "./sinistres.service";

@Controller("sinistres")
export class SinistresController {
  constructor(private readonly sinistresService: SinistresService) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateSinistreDto) {
    return this.sinistresService.create(req.user!.sub, dto);
  }

  @Get()
  findAll() {
    return this.sinistresService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.sinistresService.findById(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateSinistreDto) {
    return this.sinistresService.update(id, dto);
  }

  @Patch(":id/archiver")
  archive(@Param("id") id: string) {
    return this.sinistresService.archive(id);
  }
}
