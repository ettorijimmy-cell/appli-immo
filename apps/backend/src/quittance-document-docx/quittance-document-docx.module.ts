import { Module } from "@nestjs/common";
import { BienModule } from "../bien/bien.module";
import { DatabaseModule } from "../database/database.module";
import { QuittanceDocumentDocxController } from "./quittance-document-docx.controller";
import { QuittanceDocumentDocxService } from "./quittance-document-docx.service";

@Module({
  imports: [DatabaseModule, BienModule],
  controllers: [QuittanceDocumentDocxController],
  providers: [QuittanceDocumentDocxService],
  exports: [QuittanceDocumentDocxService]
})
export class QuittanceDocumentDocxModule {}
