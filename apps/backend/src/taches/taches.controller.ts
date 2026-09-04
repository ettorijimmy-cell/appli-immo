import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { AppliquerRevisionDto } from "./dto/appliquer-revision.dto";
import { TachesJobService } from "./taches-job.service";
import { TachesService, type FindAllTachesFiltres } from "./taches.service";

@Controller("taches")
export class TachesController {
  constructor(
    private readonly tachesService: TachesService,
    private readonly tachesJobService: TachesJobService
  ) {}

  @Get()
  findAll(
    @Query("statut") statut?: FindAllTachesFiltres["statut"],
    @Query("type") type?: FindAllTachesFiltres["type"],
    @Query("bailId") bailId?: string,
    @Query("appartementId") appartementId?: string
  ) {
    const filtres: FindAllTachesFiltres = {
      ...(statut !== undefined && { statut }),
      ...(type !== undefined && { type }),
      ...(bailId !== undefined && { bailId }),
      ...(appartementId !== undefined && { appartementId })
    };
    return this.tachesService.findAll(filtres);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.tachesService.findById(id);
  }

  // Déclenchement manuel — exécute exactement le même code que le cron
  // quotidien (@Cron, TachesJobService), même principe que
  // AlertesController.executerJob.
  @Post("executer-job")
  async executerJob() {
    await this.tachesJobService.genererTachesDepuisAlertes();
    const dateReference = new Date().toISOString().slice(0, 10);
    await this.tachesJobService.genererTachesRevisionLoyer(dateReference);
    // Manquait depuis l'Étape 4 (quittance mensuelle, 2026-08-31) — ce
    // déclenchement manuel doit exécuter exactement le même code que le
    // cron quotidien (commentaire ci-dessus), pas un sous-ensemble.
    await this.tachesJobService.genererTachesQuittanceMensuelle();
    return this.tachesService.findAll({});
  }

  @Patch(":id/marquer-fait")
  marquerFait(@Param("id") id: string) {
    return this.tachesService.marquerFait(id);
  }

  @Patch(":id/marquer-annulee")
  marquerAnnulee(@Param("id") id: string) {
    return this.tachesService.marquerAnnulee(id);
  }

  // Action dédiée pour une tâche revision_loyer — pas marquerFait, le
  // montant proposé doit pouvoir être ajusté avant application.
  @Patch(":id/appliquer-revision")
  appliquerRevision(@Param("id") id: string, @Body() dto: AppliquerRevisionDto) {
    return this.tachesService.appliquerRevision(id, dto.nouveauLoyerValide);
  }

  // Action générique (Module Tâches, Étape 3 — intégration Gmail,
  // 2026-09-01) : envoie la notification déjà résolue en metadata via
  // Gmail, marque la tâche fait. Voir TachesService.envoyerNotification.
  @Patch(":id/envoyer-notification")
  envoyerNotification(@Param("id") id: string) {
    return this.tachesService.envoyerNotification(id);
  }
}
