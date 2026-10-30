import { Module } from "@nestjs/common";
import { BienModule } from "../bien/bien.module";
import { DatabaseModule } from "../database/database.module";
import { DocumentsModule } from "../documents/documents.module";
import { EtatsDesLieuxModule } from "../etats-des-lieux/etats-des-lieux.module";
import { EtatDesLieuxDocumentDocxController } from "./etat-des-lieux-document-docx.controller";
import { EtatDesLieuxDocumentDocxService } from "./etat-des-lieux-document-docx.service";

@Module({
  imports: [DatabaseModule, DocumentsModule, EtatsDesLieuxModule, BienModule],
  controllers: [EtatDesLieuxDocumentDocxController],
  providers: [EtatDesLieuxDocumentDocxService],
  // Chantier PDF étape 4 (2026-10-27) : premier consommateur externe,
  // EtatDesLieuxPdfModule (génération du .docx figé juste après signature).
  exports: [EtatDesLieuxDocumentDocxService]
})
export class EtatDesLieuxDocumentDocxModule {}
