import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { ReglesCategorisationController } from "./regles-categorisation.controller";
import { ReglesCategorisationService } from "./regles-categorisation.service";

@Module({
  imports: [UsersModule],
  controllers: [ReglesCategorisationController],
  providers: [ReglesCategorisationService],
  exports: [ReglesCategorisationService]
})
export class ReglesCategorisationModule {}
