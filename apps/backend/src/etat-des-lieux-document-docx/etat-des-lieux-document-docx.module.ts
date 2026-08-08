import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { DocumentsModule } from "../documents/documents.module";
import { EtatsDesLieuxModule } from "../etats-des-lieux/etats-des-lieux.module";
import { EtatDesLieuxDocumentDocxController } from "./etat-des-lieux-document-docx.controller";
import { EtatDesLieuxDocumentDocxService } from "./etat-des-lieux-document-docx.service";

@Module({
  imports: [DatabaseModule, DocumentsModule, EtatsDesLieuxModule],
  controllers: [EtatDesLieuxDocumentDocxController],
  providers: [EtatDesLieuxDocumentDocxService]
})
export class EtatDesLieuxDocumentDocxModule {}
