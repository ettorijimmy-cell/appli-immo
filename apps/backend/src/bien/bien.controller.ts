import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { BienService } from "./bien.service";
import { CreateBienDto } from "./dto/create-bien.dto";
import { UpdateBienDto } from "./dto/update-bien.dto";

@Controller("biens")
export class BienController {
  constructor(private readonly bienService: BienService) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateBienDto) {
    return this.bienService.create(req.user!.sub, dto);
  }

  @Get()
  findAll(@Query("sciId") sciId?: string) {
    return this.bienService.findAll(sciId);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.bienService.findById(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateBienDto) {
    return this.bienService.update(id, dto);
  }

  @Patch(":id/archiver")
  archive(@Param("id") id: string) {
    return this.bienService.archive(id);
  }
}
