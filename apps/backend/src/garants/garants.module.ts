import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { GarantsController } from "./garants.controller";
import { GarantsService } from "./garants.service";

@Module({
  imports: [UsersModule],
  controllers: [GarantsController],
  providers: [GarantsService],
  exports: [GarantsService]
})
export class GarantsModule {}
