import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { EvenementsCalendrierController } from "./evenements-calendrier.controller";
import { EvenementsCalendrierService } from "./evenements-calendrier.service";

@Module({
  imports: [UsersModule],
  controllers: [EvenementsCalendrierController],
  providers: [EvenementsCalendrierService],
  exports: [EvenementsCalendrierService]
})
export class EvenementsCalendrierModule {}
