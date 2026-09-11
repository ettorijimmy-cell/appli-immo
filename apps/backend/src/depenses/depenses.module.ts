import { Module } from "@nestjs/common";
import { ReglesCategorisationModule } from "../regles-categorisation/regles-categorisation.module";
import { UsersModule } from "../users/users.module";
import { DepensesController } from "./depenses.controller";
import { DepensesService } from "./depenses.service";

@Module({
  imports: [UsersModule, ReglesCategorisationModule],
  controllers: [DepensesController],
  providers: [DepensesService],
  exports: [DepensesService]
})
export class DepensesModule {}
