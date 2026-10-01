import { Module } from "@nestjs/common";
import { RegularisationChargesService } from "./regularisation-charges.service";

@Module({
  providers: [RegularisationChargesService],
  exports: [RegularisationChargesService]
})
export class RegularisationChargesModule {}
