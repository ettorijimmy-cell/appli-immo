import { Module } from "@nestjs/common";
import { BauxController } from "./baux.controller";
import { BauxService } from "./baux.service";

@Module({
  controllers: [BauxController],
  providers: [BauxService],
  exports: [BauxService]
})
export class BauxModule {}
