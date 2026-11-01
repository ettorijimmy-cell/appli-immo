import { Module } from "@nestjs/common";
import { EtatDesLieuxPdfModule } from "../etat-des-lieux-pdf/etat-des-lieux-pdf.module";
import { EtatsDesLieuxModule } from "../etats-des-lieux/etats-des-lieux.module";
import { MessagerieModule } from "../messagerie/messagerie.module";
import { OrganisationResolutionModule } from "../organisation-resolution/organisation-resolution.module";
import { EtatDesLieuxEnvoiJobService } from "./etat-des-lieux-envoi-job.service";
import { EtatDesLieuxEnvoiController } from "./etat-des-lieux-envoi.controller";
import { EtatDesLieuxEnvoiService } from "./etat-des-lieux-envoi.service";

@Module({
  imports: [EtatsDesLieuxModule, EtatDesLieuxPdfModule, MessagerieModule, OrganisationResolutionModule],
  controllers: [EtatDesLieuxEnvoiController],
  providers: [EtatDesLieuxEnvoiService, EtatDesLieuxEnvoiJobService]
})
export class EtatDesLieuxEnvoiModule {}
