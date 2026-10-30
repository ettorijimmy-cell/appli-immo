import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { EtatDesLieuxPdfService } from "./etat-des-lieux-pdf.service";

// Relance planifiée (chantier PDF étape 4, filet de sécurité en plus de
// la relance à la lecture — voir EtatDesLieuxPdfService.listerDocumentsFiges)
// : rattrape toute phase signée dont le .docx et/ou le PDF figé manque
// encore (échec Gotenberg transitoire, chaîne coupée par
// onApplicationShutdown, etc.). Même cadence que ImapSyncJobService
// (EVERY_10_MINUTES) — volume très faible (quelques états des lieux
// signés par an), aucune urgence à resserrer l'intervalle.
//
// rattraperDocumentsManquantsEnArrierePlan ne rejette jamais (voir son
// commentaire, etat-des-lieux-pdf.service.ts) : le try/catch ci-dessous
// est un filet redondant, jamais censé se déclencher en pratique.
// Traité séquentiellement (pas de Promise.all) : volume négligeable, et
// ça évite de solliciter Gotenberg avec plusieurs conversions à froid en
// même temps pour un gain nul à ce volume.
@Injectable()
export class EtatDesLieuxPdfJobService {
  private readonly logger = new Logger(EtatDesLieuxPdfJobService.name);

  constructor(private readonly etatDesLieuxPdfService: EtatDesLieuxPdfService) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async rattraperDocumentsManquants(): Promise<void> {
    const incomplets = await this.etatDesLieuxPdfService.trouverPhasesSigneesIncompletes();
    for (const { etatDesLieuxId, phase } of incomplets) {
      try {
        await this.etatDesLieuxPdfService.rattraperDocumentsManquantsEnArrierePlan(etatDesLieuxId, phase);
      } catch (erreur) {
        this.logger.error(
          `Échec inattendu de la relance planifiée pour l'état des lieux ${etatDesLieuxId} (${phase})`,
          erreur instanceof Error ? erreur.stack : String(erreur)
        );
      }
    }
  }
}
