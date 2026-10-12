import { Module } from "@nestjs/common";
import { OrganisationResolutionModule } from "../organisation-resolution/organisation-resolution.module";
import { ReglesCategorisationModule } from "../regles-categorisation/regles-categorisation.module";
import { UsersModule } from "../users/users.module";
import { DepensesController } from "./depenses.controller";
import { DepensesService } from "./depenses.service";

@Module({
  imports: [UsersModule, ReglesCategorisationModule, OrganisationResolutionModule],
  controllers: [DepensesController],
  providers: [DepensesService],
  exports: [DepensesService]
})
export class DepensesModule {}
