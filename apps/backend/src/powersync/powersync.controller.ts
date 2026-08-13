import { Controller, Get, Req } from "@nestjs/common";
import type { Request } from "express";
import { PowerSyncService, type PowerSyncCredentials } from "./powersync.service";

@Controller("powersync")
export class PowerSyncController {
  constructor(private readonly powerSyncService: PowerSyncService) {}

  // Pas de @Public() : nécessite un utilisateur déjà authentifié (garde
  // globale JwtAuthGuard) — ce jeton PowerSync est émis pour l'utilisateur
  // courant, pas accessible sans être déjà connecté à l'application.
  @Get("token")
  emettreToken(@Req() req: Request): Promise<PowerSyncCredentials> {
    return this.powerSyncService.emettreCredentials(req.user!.sub);
  }
}
