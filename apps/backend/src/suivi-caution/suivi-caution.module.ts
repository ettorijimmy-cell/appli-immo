import { Module } from "@nestjs/common";
import { BailDocumentDocxModule } from "../bail-document-docx/bail-document-docx.module";
import { DatabaseModule } from "../database/database.module";
import { SuiviCautionController } from "./suivi-caution.controller";
import { SuiviCautionService } from "./suivi-caution.service";

@Module({
  imports: [DatabaseModule, BailDocumentDocxModule],
  controllers: [SuiviCautionController],
  providers: [SuiviCautionService]
})
export class SuiviCautionModule {}
