import { Module } from "@nestjs/common";
import { DocumentsModule } from "../documents/documents.module";
import { EtatDesLieuxDocumentDocxModule } from "../etat-des-lieux-document-docx/etat-des-lieux-document-docx.module";
import { EtatsDesLieuxModule } from "../etats-des-lieux/etats-des-lieux.module";
import { GotenbergModule } from "../gotenberg/gotenberg.module";
import { OrganisationResolutionModule } from "../organisation-resolution/organisation-resolution.module";
import { StorageModule } from "../storage/storage.module";
import { EtatDesLieuxPdfController } from "./etat-des-lieux-pdf.controller";
import { EtatDesLieuxPdfJobService } from "./etat-des-lieux-pdf-job.service";
import { EtatDesLieuxPdfService } from "./etat-des-lieux-pdf.service";

@Module({
  imports: [StorageModule, DocumentsModule, EtatDesLieuxDocumentDocxModule, EtatsDesLieuxModule, GotenbergModule, OrganisationResolutionModule],
  controllers: [EtatDesLieuxPdfController],
  // EtatDesLieuxPdfJobService jamais exporté (même principe que
  // IndicesIrlJobService/ImapSyncJobService) : @Cron s'enregistre tout
  // seul via ScheduleModule.forRoot() (global, AppModule), aucun autre
  // module n'a besoin d'y référencer cette classe.
  providers: [EtatDesLieuxPdfService, EtatDesLieuxPdfJobService],
  // Consommé par EtatsDesLieuxSignatureModule (génération juste après
  // signature) — voir EtatsDesLieuxSignatureService.
  exports: [EtatDesLieuxPdfService]
})
export class EtatDesLieuxPdfModule {}
