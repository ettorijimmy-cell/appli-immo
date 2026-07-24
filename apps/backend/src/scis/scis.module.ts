import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { ScisController } from "./scis.controller";
import { ScisService } from "./scis.service";

@Module({
  imports: [UsersModule],
  controllers: [ScisController],
  providers: [ScisService],
  exports: [ScisService]
})
export class ScisModule {}
