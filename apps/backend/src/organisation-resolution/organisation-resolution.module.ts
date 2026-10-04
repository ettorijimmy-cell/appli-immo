import { Module } from "@nestjs/common";
import { OrganisationResolutionService } from "./organisation-resolution.service";

@Module({
  providers: [OrganisationResolutionService],
  exports: [OrganisationResolutionService]
})
export class OrganisationResolutionModule {}
