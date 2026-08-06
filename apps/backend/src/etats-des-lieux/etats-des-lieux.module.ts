import { Module } from "@nestjs/common";
import { EtatsDesLieuxController } from "./etats-des-lieux.controller";
import { EtatsDesLieuxService } from "./etats-des-lieux.service";

@Module({
  controllers: [EtatsDesLieuxController],
  providers: [EtatsDesLieuxService],
  exports: [EtatsDesLieuxService]
})
export class EtatsDesLieuxModule {}
