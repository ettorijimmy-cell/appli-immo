import { Module } from "@nestjs/common";
import { TableauDeBordModule } from "../tableau-de-bord/tableau-de-bord.module";
import { UsersModule } from "../users/users.module";
import { FiscaliteController } from "./fiscalite.controller";
import { FiscaliteService } from "./fiscalite.service";

@Module({
  imports: [UsersModule, TableauDeBordModule],
  controllers: [FiscaliteController],
  providers: [FiscaliteService],
  exports: [FiscaliteService]
})
export class FiscaliteModule {}
