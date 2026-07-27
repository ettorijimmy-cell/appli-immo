import { Module } from "@nestjs/common";
import { LocatairesController } from "./locataires.controller";
import { LocatairesService } from "./locataires.service";

@Module({
  controllers: [LocatairesController],
  providers: [LocatairesService],
  exports: [LocatairesService]
})
export class LocatairesModule {}
