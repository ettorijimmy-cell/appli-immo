import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { DepensesController } from "./depenses.controller";
import { DepensesService } from "./depenses.service";

@Module({
  imports: [UsersModule],
  controllers: [DepensesController],
  providers: [DepensesService],
  exports: [DepensesService]
})
export class DepensesModule {}
