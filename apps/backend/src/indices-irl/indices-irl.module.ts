import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { IndicesIrlController } from "./indices-irl.controller";
import { IndicesIrlJobService } from "./indices-irl-job.service";
import { IndicesIrlService } from "./indices-irl.service";

@Module({
  imports: [DatabaseModule],
  controllers: [IndicesIrlController],
  providers: [IndicesIrlService, IndicesIrlJobService],
  exports: [IndicesIrlService]
})
export class IndicesIrlModule {}
