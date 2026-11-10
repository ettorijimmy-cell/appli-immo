import { Module } from "@nestjs/common";
import { BienModule } from "../bien/bien.module";
import { DatabaseModule } from "../database/database.module";
import { BailDocumentDocxController } from "./bail-document-docx.controller";
import { BailDocumentDocxService } from "./bail-document-docx.service";

@Module({
  imports: [DatabaseModule, BienModule],
  controllers: [BailDocumentDocxController],
  providers: [BailDocumentDocxService],
  // Acte de cautionnement : même lecture des parties du bail.
  exports: [BailDocumentDocxService]
})
export class BailDocumentDocxModule {}
