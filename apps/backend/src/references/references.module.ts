import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { ReferencesController } from "./references.controller";
import { ReferencesService } from "./references.service";

// N'importe pas DocumentsModule en entier : seul DocumentStorageService
// (via StorageModule) est nécessaire ici — DocumentsService (Postgres,
// table documents) n'a aucun rapport avec un fichier de référence non
// rattaché à une entité.
@Module({
  imports: [StorageModule],
  controllers: [ReferencesController],
  providers: [ReferencesService]
})
export class ReferencesModule {}
