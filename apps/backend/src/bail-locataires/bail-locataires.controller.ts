import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { BailLocatairesService } from "./bail-locataires.service";
import { ArchiverBailLocataireDto } from "./dto/archiver-bail-locataire.dto";
import { CreateBailLocataireDto } from "./dto/create-bail-locataire.dto";
import { UpdateBailLocataireDto } from "./dto/update-bail-locataire.dto";

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

  // Date d'effet du congé du locataire (chantier garants, commit 6) :
  // seul champ modifiable d'un lien, null pour l'effacer.
  @Patch(":id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateBailLocataireDto) {
    return this.bailLocatairesService.update(id, dto);
  }

  // Retrait du locataire, avec la date d'effet de son congé si elle est
  // fournie (chantier garants, commit 6).
  @Patch(":id/archiver")
  archive(@Param("id") id: string, @Body() dto: ArchiverBailLocataireDto) {
    return this.bailLocatairesService.archive(id, dto);
  }
}
