import { Module } from "@nestjs/common";
import { BailDocumentDocxModule } from "../bail-document-docx/bail-document-docx.module";
import { BienModule } from "../bien/bien.module";
import { DatabaseModule } from "../database/database.module";
import { ActeCautionnementDocxController } from "./acte-cautionnement-docx.controller";
import { ActeCautionnementDocxService } from "./acte-cautionnement-docx.service";

@Module({
  imports: [DatabaseModule, BienModule, BailDocumentDocxModule],
  controllers: [ActeCautionnementDocxController],
  providers: [ActeCautionnementDocxService]
})
export class ActeCautionnementDocxModule {}
