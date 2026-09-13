import { Module } from "@nestjs/common";
import { LocatairesModule } from "../locataires/locataires.module";
import { UsersModule } from "../users/users.module";
import { CandidatsController } from "./candidats.controller";
import { CandidatsService } from "./candidats.service";

@Module({
  imports: [UsersModule, LocatairesModule],
  controllers: [CandidatsController],
  providers: [CandidatsService],
  exports: [CandidatsService]
})
export class CandidatsModule {}
