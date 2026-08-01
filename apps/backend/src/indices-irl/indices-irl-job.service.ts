import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { IndicesIrlService } from "./indices-irl.service";

/**
 * Tâche planifiée quotidienne — vérifie une nouvelle publication IRL,
 * jamais un appel à chaque génération de bail (docs/backlog.md, section
 * "Édition d'un bail"). L'IRL n'est publié que trimestriellement ; une
 * vérification quotidienne est sans coût réel (un seul appel HTTP léger)
 * et garantit qu'une nouvelle valeur est captée au plus tard le lendemain
 * de sa publication.
 *
 * Chaque échec est explicitement journalisé (Logger.error) — jamais un
 * silence qui ne se remarque qu'au moment où `irlEstPerime` finit par
 * bloquer une génération de bail réelle, potentiellement des mois plus
 * tard.
 */
@Injectable()
export class IndicesIrlJobService {
  private readonly logger = new Logger(IndicesIrlJobService.name);

  constructor(private readonly indicesIrlService: IndicesIrlService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async executerJobQuotidien(): Promise<void> {
    try {
      await this.indicesIrlService.synchroniser();
      this.logger.log("Synchronisation de l'indice IRL exécutée avec succès.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Échec de la synchronisation de l'indice IRL (INSEE) : ${message}`);
    }
  }
}
