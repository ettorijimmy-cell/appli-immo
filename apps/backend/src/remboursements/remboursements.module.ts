import { Module } from "@nestjs/common";
import { DocumentStorageService } from "../documents/storage/document-storage.service";
import { RemboursementsController } from "./remboursements.controller";
import { RemboursementsService } from "./remboursements.service";

// DocumentStorageService fourni directement comme provider (pas d'import de
// DocumentsModule) : même redesign que ReferencesModule — la classe est
// stateless en dehors de sa config S3/EncryptionService (global), inutile de
// tirer DocumentsService et sa dépendance Postgres. AuditService n'a pas
// besoin d'être listé ici : AuditModule est @Global (voir audit.module.ts).
@Module({
  controllers: [RemboursementsController],
  providers: [RemboursementsService, DocumentStorageService],
  exports: [RemboursementsService]
})
export class RemboursementsModule {}
