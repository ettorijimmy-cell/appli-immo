import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { LocatairesController } from "./locataires.controller";
import { LocatairesService } from "./locataires.service";

@Module({
  imports: [UsersModule],
  controllers: [LocatairesController],
  providers: [LocatairesService],
  exports: [LocatairesService]
})
export class LocatairesModule {}
