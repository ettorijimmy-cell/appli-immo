import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { BailLocatairesService } from "./bail-locataires.service";
import { CreateBailLocataireDto } from "./dto/create-bail-locataire.dto";

@UseGuards(JwtAuthGuard)
@Controller("bail-locataires")
export class BailLocatairesController {
  constructor(private readonly bailLocatairesService: BailLocatairesService) {}

  @Post()
  create(@Body() dto: CreateBailLocataireDto) {
    return this.bailLocatairesService.create(dto);
  }

  @Get()
  findAll(@Query("bailId") bailId?: string, @Query("locataireId") locataireId?: string) {
    return this.bailLocatairesService.findAll(bailId, locataireId);
  }

  @Patch(":id/archiver")
  archive(@Param("id") id: string) {
    return this.bailLocatairesService.archive(id);
  }
}
