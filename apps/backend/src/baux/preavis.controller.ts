import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { DeclarerPreavisDto } from "./dto/declarer-preavis.dto";
import { PreavisService } from "./preavis.service";

// Préavis d'un bail (résiliation, conception 2 « vrai préavis ») : voir
// PreavisService pour l'ordre des contrôles et les écritures.
@Controller("baux")
export class PreavisController {
  constructor(private readonly preavisService: PreavisService) {}

  @Get(":id/preavis")
  consulter(@Param("id") id: string) {
    return this.preavisService.consulter(id);
  }

  @Post(":id/preavis")
  declarer(@Param("id") id: string, @Body() dto: DeclarerPreavisDto) {
    return this.preavisService.declarer(id, dto);
  }

  @Patch(":id/preavis")
  corriger(@Param("id") id: string, @Body() dto: DeclarerPreavisDto) {
    return this.preavisService.corriger(id, dto);
  }

  @Patch(":id/preavis/annuler")
  annuler(@Param("id") id: string) {
    return this.preavisService.annuler(id);
  }
}
