import { Controller, Get, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { IndicesIrlJobService } from "./indices-irl-job.service";
import { IndicesIrlService } from "./indices-irl.service";

@UseGuards(JwtAuthGuard)
@Controller("indices-irl")
export class IndicesIrlController {
  constructor(
    private readonly indicesIrlService: IndicesIrlService,
    private readonly indicesIrlJobService: IndicesIrlJobService
  ) {}

  @Get("derniere-valeur")
  obtenirDerniereValeur() {
    return this.indicesIrlService.obtenirDerniereValeur();
  }

  // Déclenchement manuel — exécute exactement le même code que le cron
  // quotidien (@Cron, IndicesIrlJobService), pour vérifier le comportement
  // sans attendre la prochaine exécution planifiée.
  @Post("executer-job")
  async executerJob() {
    await this.indicesIrlJobService.executerJobQuotidien();
    return this.indicesIrlService.obtenirDerniereValeur();
  }
}
