import { Module } from "@nestjs/common";
import { CandidatsModule } from "../candidats/candidats.module";
import { GarantsModule } from "../garants/garants.module";
import { LocatairesModule } from "../locataires/locataires.module";
import { UsersModule } from "../users/users.module";
import { ContactsController } from "./contacts.controller";
import { ContactsService } from "./contacts.service";

@Module({
  imports: [UsersModule, LocatairesModule, GarantsModule, CandidatsModule],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService]
})
export class ContactsModule {}
