import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { BailDocumentController } from "./bail-document.controller";
import { BailDocumentService } from "./bail-document.service";

@Module({
  imports: [DatabaseModule],
  controllers: [BailDocumentController],
  providers: [BailDocumentService]
})
export class BailDocumentModule {}
