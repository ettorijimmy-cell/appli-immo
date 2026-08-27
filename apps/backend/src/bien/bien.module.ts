import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { BienController } from "./bien.controller";
import { BienService } from "./bien.service";

@Module({
  imports: [UsersModule],
  controllers: [BienController],
  providers: [BienService],
  exports: [BienService]
})
export class BienModule {}
