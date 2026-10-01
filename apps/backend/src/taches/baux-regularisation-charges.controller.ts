import { Body, Controller, Param, Post } from "@nestjs/common";
import { DeclencherRegularisationChargesDto } from "./dto/declencher-regularisation-charges.dto";
import { TachesJobService } from "./taches-job.service";

// Route nichée sous /baux (cohérent avec BauxController : activer/resilier
// sont déjà des actions de bail), mais contrôleur posé dans TachesModule —
// pas BauxModule — pour réutiliser TachesJobService sans créer de
// dépendance circulaire (TachesModule importe déjà RegularisationChargesModule,
// voir taches.module.ts). Même code exact que le déclenchement automatique
// (genererTacheRegularisationSiNecessaire), seule la période est fournie
// explicitement plutôt que déduite de la date anniversaire.
@Controller("baux")
export class BauxRegularisationChargesController {
  constructor(private readonly tachesJobService: TachesJobService) {}

  @Post(":id/regularisation-charges")
  declencher(@Param("id") id: string, @Body() dto: DeclencherRegularisationChargesDto) {
    const dateEcheance = new Date().toISOString().slice(0, 10);
    return this.tachesJobService.genererTacheRegularisationSiNecessaire(id, dto.periodeDebut, dto.periodeFin, dateEcheance);
  }
}
