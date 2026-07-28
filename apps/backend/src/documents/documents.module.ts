import { Module } from "@nestjs/common";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { DocumentStorageService } from "./storage/document-storage.service";

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentStorageService],
  exports: [DocumentsService]
})
export class DocumentsModule {}
