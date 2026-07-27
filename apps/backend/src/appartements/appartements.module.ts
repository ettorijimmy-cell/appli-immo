import { Module } from "@nestjs/common";
import { AppartementsController } from "./appartements.controller";
import { AppartementsService } from "./appartements.service";

@Module({
  controllers: [AppartementsController],
  providers: [AppartementsService],
  exports: [AppartementsService]
})
export class AppartementsModule {}
