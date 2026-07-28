import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AlertesConfigService, TYPES_AVEC_SEUIL_CONFIGURABLE, type AlerteType } from "./alertes-config.service";
import { AlertesJobService } from "./alertes-job.service";
import { AlertesService, type FindAllAlertesFiltres } from "./alertes.service";
import { UpdateSeuilAlerteDto } from "./dto/update-seuil-alerte.dto";

@UseGuards(JwtAuthGuard)
@Controller("alertes")
export class AlertesController {
  constructor(
    private readonly alertesService: AlertesService,
    private readonly alertesJobService: AlertesJobService
  ) {}

  @Get()
  findAll(
    @Query("statut") statut?: "active" | "traitee" | "ignoree" | "resolue",
    @Query("type") type?: AlerteType
  ) {
    const filtres: FindAllAlertesFiltres = {
      ...(statut !== undefined && { statut }),
      ...(type !== undefined && { type })
    };
    return this.alertesService.findAll(filtres);
  }

  // Déclenchement manuel — exécute exactement le même code que le cron
  // quotidien (@Cron, AlertesJobService), avec la date du jour, pour
  // pouvoir vérifier le comportement sans attendre la prochaine exécution
  // planifiée (1h du matin).
  @Post("executer-job")
  async executerJob() {
    const dateReference = new Date().toISOString().slice(0, 10);
    await this.alertesJobService.genererEcheancesRecurrentes(dateReference);
    await this.alertesJobService.genererAlertes(dateReference);
    return this.alertesService.findAll({});
  }

  @Patch(":id/traiter")
  traiter(@Param("id") id: string) {
    return this.alertesService.traiter(id);
  }

  @Patch(":id/ignorer")
  ignorer(@Param("id") id: string) {
    return this.alertesService.ignorer(id);
  }
}

@UseGuards(JwtAuthGuard)
@Controller("parametres-alertes")
export class ParametresAlertesController {
  constructor(private readonly alertesConfigService: AlertesConfigService) {}

  @Get()
  findAll() {
    return this.alertesConfigService.findAll();
  }

  @Patch(":type")
  update(@Param("type") type: string, @Body() dto: UpdateSeuilAlerteDto) {
    if (!TYPES_AVEC_SEUIL_CONFIGURABLE.includes(type as AlerteType)) {
      throw new BadRequestException(`Type d'alerte inconnu ou sans seuil configurable : '${type}'`);
    }
    return this.alertesConfigService.update(type as AlerteType, dto.seuilJoursAvant);
  }
}
