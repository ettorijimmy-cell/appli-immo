import { Module } from "@nestjs/common";
import { GarantsController } from "./garants.controller";
import { GarantsService } from "./garants.service";

@Module({
  controllers: [GarantsController],
  providers: [GarantsService],
  exports: [GarantsService]
})
export class GarantsModule {}
