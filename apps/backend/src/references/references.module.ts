import { Module } from "@nestjs/common";
import { DocumentStorageService } from "../documents/storage/document-storage.service";
import { ReferencesController } from "./references.controller";
import { ReferencesService } from "./references.service";

// N'importe pas DocumentsModule en entier : seul DocumentStorageService
// (stateless côté config, sans dépendance Postgres) est nécessaire ici —
// DocumentsService (Postgres, table documents) n'a aucun rapport avec un
// fichier de référence non rattaché à une entité. Instance séparée de
// celle de DocumentsModule, sans problème : DocumentStorageService ne
// porte aucun état partagé entre requêtes.
@Module({
  controllers: [ReferencesController],
  providers: [ReferencesService, DocumentStorageService]
})
export class ReferencesModule {}
