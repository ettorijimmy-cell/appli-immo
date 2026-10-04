import { Module } from "@nestjs/common";
import { OrganisationResolutionModule } from "../organisation-resolution/organisation-resolution.module";
import { AlertesConfigService } from "./alertes-config.service";
import { AlertesJobService } from "./alertes-job.service";
import { AlertesController, ParametresAlertesController } from "./alertes.controller";
import { AlertesService } from "./alertes.service";

@Module({
  imports: [OrganisationResolutionModule],
  controllers: [AlertesController, ParametresAlertesController],
  providers: [AlertesConfigService, AlertesJobService, AlertesService],
  exports: [AlertesConfigService, AlertesJobService, AlertesService]
})
export class AlertesModule {}
