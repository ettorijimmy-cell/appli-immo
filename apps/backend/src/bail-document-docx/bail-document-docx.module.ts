import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { BailDocumentDocxController } from "./bail-document-docx.controller";
import { BailDocumentDocxService } from "./bail-document-docx.service";

@Module({
  imports: [DatabaseModule],
  controllers: [BailDocumentDocxController],
  providers: [BailDocumentDocxService]
})
export class BailDocumentDocxModule {}
