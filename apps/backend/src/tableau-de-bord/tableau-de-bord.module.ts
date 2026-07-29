import { Module } from "@nestjs/common";
import { DerniereSauvegardeService } from "./derniere-sauvegarde.service";
import { TableauDeBordController } from "./tableau-de-bord.controller";
import { TableauDeBordService } from "./tableau-de-bord.service";

@Module({
  controllers: [TableauDeBordController],
  providers: [TableauDeBordService, DerniereSauvegardeService],
  exports: [TableauDeBordService, DerniereSauvegardeService]
})
export class TableauDeBordModule {}
