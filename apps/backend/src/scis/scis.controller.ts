import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CreateSciDto } from "./dto/create-sci.dto";
import { ScisService } from "./scis.service";

@UseGuards(JwtAuthGuard)
@Controller("scis")
export class ScisController {
  constructor(private readonly scisService: ScisService) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateSciDto) {
    return this.scisService.create(req.user!.sub, dto);
  }

  @Get()
  findAll() {
    return this.scisService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.scisService.findById(id);
  }

  @Patch(":id/archiver")
  archive(@Param("id") id: string) {
    return this.scisService.archive(id);
  }
}
