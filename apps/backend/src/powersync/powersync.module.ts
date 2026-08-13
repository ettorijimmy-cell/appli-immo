import { Module } from "@nestjs/common";
import { PowerSyncController } from "./powersync.controller";
import { PowerSyncService } from "./powersync.service";

@Module({
  controllers: [PowerSyncController],
  providers: [PowerSyncService]
})
export class PowerSyncModule {}
