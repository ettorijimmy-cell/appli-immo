import { Module } from "@nestjs/common";
import { AlertesConfigService } from "./alertes-config.service";
import { AlertesJobService } from "./alertes-job.service";
import { AlertesController, ParametresAlertesController } from "./alertes.controller";
import { AlertesService } from "./alertes.service";

@Module({
  controllers: [AlertesController, ParametresAlertesController],
  providers: [AlertesConfigService, AlertesJobService, AlertesService],
  exports: [AlertesConfigService, AlertesJobService, AlertesService]
})
export class AlertesModule {}
