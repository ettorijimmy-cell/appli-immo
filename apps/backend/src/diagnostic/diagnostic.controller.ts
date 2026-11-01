import { Controller, Get } from "@nestjs/common";
import { DiagnosticGotenbergService, type DiagnosticGotenberg } from "./diagnostic-gotenberg.service";
import { DiagnosticSmtpService, type DiagnosticSmtp } from "./diagnostic-smtp.service";

// Pas de @UseGuards ni @Public() : protégée par le JwtAuthGuard global
// habituel (échec sécurisé par défaut, voir auth.module.ts), comme toute
// autre route de ce backend.
@Controller("diagnostic")
export class DiagnosticController {
  constructor(
    private readonly diagnosticGotenbergService: DiagnosticGotenbergService,
    private readonly diagnosticSmtpService: DiagnosticSmtpService
  ) {}

  @Get("gotenberg")
  diagnostiquerGotenberg(): Promise<DiagnosticGotenberg> {
    return this.diagnosticGotenbergService.executer();
  }

  // Connexion, EHLO, STARTTLS et authentification sur les ports 465 et 587,
  // sans jamais envoyer de mail (voir DiagnosticSmtpService).
  @Get("smtp")
  diagnostiquerSmtp(): Promise<DiagnosticSmtp> {
    return this.diagnosticSmtpService.executer();
  }
}
