import { Module } from "@nestjs/common";
import { ImmeublesController } from "./immeubles.controller";
import { ImmeublesService } from "./immeubles.service";

@Module({
  controllers: [ImmeublesController],
  providers: [ImmeublesService],
  exports: [ImmeublesService]
})
export class ImmeublesModule {}
