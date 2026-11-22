import { Module } from "@nestjs/common";
import { AlertesModule } from "../alertes/alertes.module";
import { DocumentsModule } from "../documents/documents.module";
import { DerniereSauvegardeService } from "./derniere-sauvegarde.service";
import { TableauDeBordController } from "./tableau-de-bord.controller";
import { TableauDeBordService } from "./tableau-de-bord.service";

@Module({
  imports: [DocumentsModule, AlertesModule],
  controllers: [TableauDeBordController],
  providers: [TableauDeBordService, DerniereSauvegardeService],
  exports: [TableauDeBordService, DerniereSauvegardeService]
})
export class TableauDeBordModule {}
