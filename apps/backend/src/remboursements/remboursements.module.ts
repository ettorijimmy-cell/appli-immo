import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { RemboursementsController } from "./remboursements.controller";
import { RemboursementsService } from "./remboursements.service";

// DocumentStorageService fourni via StorageModule (pas d'import de
// DocumentsModule) : la classe est stateless en dehors de sa config S3/
// EncryptionService (global), inutile de tirer DocumentsService et sa
// dépendance Postgres. AuditService n'a pas besoin d'être listé ici :
// AuditModule est @Global (voir audit.module.ts).
@Module({
  imports: [StorageModule],
  controllers: [RemboursementsController],
  providers: [RemboursementsService],
  exports: [RemboursementsService]
})
export class RemboursementsModule {}
