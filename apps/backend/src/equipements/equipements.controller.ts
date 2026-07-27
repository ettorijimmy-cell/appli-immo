import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CreateEquipementDto } from "./dto/create-equipement.dto";
import { UpdateEquipementDto } from "./dto/update-equipement.dto";
import { EquipementsService } from "./equipements.service";

@UseGuards(JwtAuthGuard)
@Controller("equipements")
export class EquipementsController {
  constructor(private readonly equipementsService: EquipementsService) {}

  @Post()
  create(@Body() dto: CreateEquipementDto) {
    return this.equipementsService.create(dto);
  }

  @Get()
  findAll(@Query("appartementId") appartementId?: string) {
    return this.equipementsService.findAll(appartementId);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.equipementsService.findById(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateEquipementDto) {
    return this.equipementsService.update(id, dto);
  }

  @Patch(":id/archiver")
  archive(@Param("id") id: string) {
    return this.equipementsService.archive(id);
  }
}
