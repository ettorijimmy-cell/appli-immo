import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { BauxController } from "./baux.controller";
import { BauxService } from "./baux.service";
import { PreavisController } from "./preavis.controller";
import { PreavisService } from "./preavis.service";

// AuditModule importé explicitement (PreavisService journalise ses
// déclarations) : il est global dans l'application, mais plusieurs tests
// d'intégration montent BauxModule sans lui.
@Module({
  imports: [AuditModule],
  controllers: [BauxController, PreavisController],
  providers: [BauxService, PreavisService],
  exports: [BauxService, PreavisService]
})
export class BauxModule {}
