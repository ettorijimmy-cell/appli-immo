import { Module } from "@nestjs/common";
import { ModelesCourrierService } from "./modeles-courrier.service";

// Pas de controller dans cette étape (Module Tâches, Étape 2) : aucun
// endpoint HTTP exposé, aucun écran d'édition prévu — même principe que
// AuditModule.
@Module({
  providers: [ModelesCourrierService],
  exports: [ModelesCourrierService]
})
export class ModelesCourrierModule {}
