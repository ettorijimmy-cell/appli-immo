import { Controller, Get, Body, Param, Post } from "@nestjs/common";
import { RegularisationChargesService } from "../regularisation-charges/regularisation-charges.service";
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
  constructor(
    private readonly tachesJobService: TachesJobService,
    private readonly regularisationChargesService: RegularisationChargesService
  ) {}

  @Post(":id/regularisation-charges")
  declencher(@Param("id") id: string, @Body() dto: DeclencherRegularisationChargesDto) {
    const dateEcheance = new Date().toISOString().slice(0, 10);
    return this.tachesJobService.genererTacheRegularisationSiNecessaire(id, dto.periodeDebut, dto.periodeFin, dateEcheance);
  }

  // Module Régularisation des charges, Sous-commit F (2026-10-05) —
  // lecture seule, ne déclenche jamais aucun calcul ni création de tâche
  // (contrairement à la route POST ci-dessus) : sert l'écran Charges pour
  // afficher le bilan existant le plus récent et son historique, sans
  // effet de bord. RegularisationChargesService (pas TachesJobService)
  // injecté directement, cohérent avec son rôle de calcul/lecture pur.
  @Get(":id/regularisation-charges/historique")
  historique(@Param("id") id: string) {
    return this.regularisationChargesService.obtenirHistoriquePourBail(id);
  }
}
