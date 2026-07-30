import { Module } from "@nestjs/common";
import { RemboursementsController } from "./remboursements.controller";
import { RemboursementsService } from "./remboursements.service";

@Module({
  controllers: [RemboursementsController],
  providers: [RemboursementsService],
  exports: [RemboursementsService]
})
export class RemboursementsModule {}
