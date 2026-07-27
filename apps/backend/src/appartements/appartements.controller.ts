import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AppartementsService } from "./appartements.service";
import { CreateAppartementDto } from "./dto/create-appartement.dto";
import { UpdateAppartementDto } from "./dto/update-appartement.dto";

@UseGuards(JwtAuthGuard)
@Controller("appartements")
export class AppartementsController {
  constructor(private readonly appartementsService: AppartementsService) {}

  @Post()
  create(@Body() dto: CreateAppartementDto) {
    return this.appartementsService.create(dto);
  }

  @Get()
  findAll(@Query("immeubleId") immeubleId?: string) {
    return this.appartementsService.findAll(immeubleId);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.appartementsService.findById(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateAppartementDto) {
    return this.appartementsService.update(id, dto);
  }

  @Patch(":id/archiver")
  archive(@Param("id") id: string) {
    return this.appartementsService.archive(id);
  }
}
