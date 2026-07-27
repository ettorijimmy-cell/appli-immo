import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CreateImmeubleDto } from "./dto/create-immeuble.dto";
import { UpdateImmeubleDto } from "./dto/update-immeuble.dto";
import { ImmeublesService } from "./immeubles.service";

@UseGuards(JwtAuthGuard)
@Controller("immeubles")
export class ImmeublesController {
  constructor(private readonly immeublesService: ImmeublesService) {}

  @Post()
  create(@Body() dto: CreateImmeubleDto) {
    return this.immeublesService.create(dto);
  }

  @Get()
  findAll(@Query("sciId") sciId?: string) {
    return this.immeublesService.findAll(sciId);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.immeublesService.findById(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateImmeubleDto) {
    return this.immeublesService.update(id, dto);
  }

  @Patch(":id/archiver")
  archive(@Param("id") id: string) {
    return this.immeublesService.archive(id);
  }
}
