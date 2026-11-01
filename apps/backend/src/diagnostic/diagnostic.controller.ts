import { Controller, Get } from "@nestjs/common";
import { DiagnosticGotenbergService, type DiagnosticGotenberg } from "./diagnostic-gotenberg.service";

// Pas de @UseGuards ni @Public() : protégée par le JwtAuthGuard global
// habituel (échec sécurisé par défaut, voir auth.module.ts), comme toute
// autre route de ce backend.
@Controller("diagnostic")
export class DiagnosticController {
  constructor(private readonly diagnosticGotenbergService: DiagnosticGotenbergService) {}

  @Get("gotenberg")
  diagnostiquerGotenberg(): Promise<DiagnosticGotenberg> {
    return this.diagnosticGotenbergService.executer();
  }
}
