import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { EtatDesLieuxEnvoiService } from "./etat-des-lieux-envoi.service";

// Clôture aussi les envois abandonnés d'un état des lieux que personne ne
// rouvre. Sans contexte HTTP : toutes organisations confondues.
@Injectable()
export class EtatDesLieuxEnvoiJobService {
  private readonly logger = new Logger(EtatDesLieuxEnvoiJobService.name);

  constructor(private readonly etatDesLieuxEnvoiService: EtatDesLieuxEnvoiService) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async classerEnvoisAbandonnes(): Promise<void> {
    const nombre = await this.etatDesLieuxEnvoiService.classerEnvoisAbandonnes();
    if (nombre > 0) {
      this.logger.warn(`${nombre} envoi(s) d'état des lieux abandonné(s), résultat indéterminé.`);
    }
  }
}
