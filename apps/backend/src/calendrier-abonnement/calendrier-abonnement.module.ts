import { Module } from "@nestjs/common";
import { EvenementsCalendrierModule } from "../evenements-calendrier/evenements-calendrier.module";
import { UsersModule } from "../users/users.module";
import { CalendrierAbonnementController } from "./calendrier-abonnement.controller";
import { CalendrierAbonnementService } from "./calendrier-abonnement.service";
import { CalendrierIcsController } from "./calendrier-ics.controller";

@Module({
  imports: [UsersModule, EvenementsCalendrierModule],
  controllers: [CalendrierAbonnementController, CalendrierIcsController],
  providers: [CalendrierAbonnementService],
  exports: [CalendrierAbonnementService]
})
export class CalendrierAbonnementModule {}
