import { Module } from "@nestjs/common";
import { BailLocatairesController } from "./bail-locataires.controller";
import { BailLocatairesService } from "./bail-locataires.service";

@Module({
  controllers: [BailLocatairesController],
  providers: [BailLocatairesService],
  exports: [BailLocatairesService]
})
export class BailLocatairesModule {}
