import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CreateLocataireDto } from "./dto/create-locataire.dto";
import { UpdateLocataireDto } from "./dto/update-locataire.dto";
import { LocatairesService } from "./locataires.service";

@UseGuards(JwtAuthGuard)
@Controller("locataires")
export class LocatairesController {
  constructor(private readonly locatairesService: LocatairesService) {}

  @Post()
  create(@Body() dto: CreateLocataireDto) {
    return this.locatairesService.create(dto);
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
