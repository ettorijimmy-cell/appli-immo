import { Module } from "@nestjs/common";
import { GotenbergModule } from "../gotenberg/gotenberg.module";
import { DiagnosticGotenbergService } from "./diagnostic-gotenberg.service";
import { DiagnosticController } from "./diagnostic.controller";

@Module({
  imports: [GotenbergModule],
  controllers: [DiagnosticController],
  providers: [DiagnosticGotenbergService]
})
export class DiagnosticModule {}
