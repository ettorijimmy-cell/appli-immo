import { Module } from "@nestjs/common";
import { DocumentStorageService } from "./document-storage.service";

// Extrait de DocumentsModule (Module Messagerie, 2026-09-16) : plusieurs
// modules sans lien avec Documents (ReferencesModule, RemboursementsModule,
// et maintenant MessagerieModule) ont besoin de stocker un fichier chiffré
// sans jamais créer de ligne `documents` — avant ce module, chacun
// redéclarait DocumentStorageService comme son propre provider (contournement
// documenté, DocumentStorageService ne dépend que d'EncryptionService/
// ConfigService, sans état partagé), créant une instance redondante par
// module. Un seul module partagé, importé partout où le besoin existe.
@Module({
  providers: [DocumentStorageService],
  exports: [DocumentStorageService]
})
export class StorageModule {}
