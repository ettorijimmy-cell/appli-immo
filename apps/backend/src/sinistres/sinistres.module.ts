import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { SinistresController } from "./sinistres.controller";
import { SinistresService } from "./sinistres.service";

@Module({
  imports: [UsersModule],
  controllers: [SinistresController],
  providers: [SinistresService],
  exports: [SinistresService]
})
export class SinistresModule {}
