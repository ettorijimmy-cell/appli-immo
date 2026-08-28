import { Module } from "@nestjs/common";
import { TachesController } from "./taches.controller";
import { TachesJobService } from "./taches-job.service";
import { TachesService } from "./taches.service";

@Module({
  controllers: [TachesController],
  providers: [TachesJobService, TachesService],
  exports: [TachesJobService, TachesService]
})
export class TachesModule {}
