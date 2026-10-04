import { Module } from "@nestjs/common";
import { OrganisationResolutionModule } from "../organisation-resolution/organisation-resolution.module";
import { StorageModule } from "../storage/storage.module";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";

@Module({
  imports: [StorageModule, OrganisationResolutionModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService]
})
export class DocumentsModule {}
