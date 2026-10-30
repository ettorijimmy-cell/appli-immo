import { Module } from "@nestjs/common";
import { DocumentsModule } from "../documents/documents.module";
import { EtatDesLieuxDocumentDocxModule } from "../etat-des-lieux-document-docx/etat-des-lieux-document-docx.module";
import { EtatsDesLieuxModule } from "../etats-des-lieux/etats-des-lieux.module";
import { GotenbergModule } from "../gotenberg/gotenberg.module";
import { OrganisationResolutionModule } from "../organisation-resolution/organisation-resolution.module";
import { StorageModule } from "../storage/storage.module";
import { EtatDesLieuxPdfController } from "./etat-des-lieux-pdf.controller";
import { EtatDesLieuxPdfService } from "./etat-des-lieux-pdf.service";

@Module({
  imports: [StorageModule, DocumentsModule, EtatDesLieuxDocumentDocxModule, EtatsDesLieuxModule, GotenbergModule, OrganisationResolutionModule],
  controllers: [EtatDesLieuxPdfController],
  providers: [EtatDesLieuxPdfService],
  // Consommé par EtatsDesLieuxSignatureModule (génération juste après
  // signature) — voir EtatsDesLieuxSignatureService.
  exports: [EtatDesLieuxPdfService]
})
export class EtatDesLieuxPdfModule {}
