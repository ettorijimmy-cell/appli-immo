import { Module } from "@nestjs/common";
import { GotenbergModule } from "../gotenberg/gotenberg.module";
import { MessagerieModule } from "../messagerie/messagerie.module";
import { DiagnosticGotenbergService } from "./diagnostic-gotenberg.service";
import { DiagnosticSmtpService } from "./diagnostic-smtp.service";
import { DiagnosticController } from "./diagnostic.controller";

@Module({
  imports: [GotenbergModule, MessagerieModule],
  controllers: [DiagnosticController],
  providers: [DiagnosticGotenbergService, DiagnosticSmtpService]
})
export class DiagnosticModule {}
