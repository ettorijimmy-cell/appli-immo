import { Body, Controller, HttpCode, HttpStatus, Post, Req, UnauthorizedException, UseFilters } from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { LimitationTentativesConnexionService } from "./limitation-tentatives-connexion.service";
import { Public } from "./public.decorator";
import { TropDeTentativesConnexionException } from "./trop-de-tentatives-connexion.exception";
import { TropDeTentativesConnexionFilter } from "./trop-de-tentatives-connexion.filter";

// X-Real-IP : seul en-tête fiable pour l'IP réelle du client derrière
// Scaleway Serverless Containers — écrasé par l'edge Scaleway, jamais
// transmis par le client lui-même. X-Forwarded-For est explicitement
// déconseillé par Scaleway pour un usage de sécurité, contrairement au
// réflexe habituel `app.set("trust proxy", ...)`, qui ferait lire
// request.ip depuis X-Forwarded-For. Repli sur request.ip en dev local,
// où aucun en-tête de ce type n'existe (pas de proxy devant le serveur
// Nest).
export function adresseIpReelle(request: Request): string {
  const entete = request.headers["x-real-ip"];
  if (typeof entete === "string" && entete.length > 0) {
    return entete;
  }
  return request.ip ?? "inconnue";
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly limitationTentativesConnexionService: LimitationTentativesConnexionService
  ) {}

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @UseFilters(TropDeTentativesConnexionFilter)
  async login(@Body() dto: LoginDto, @Req() request: Request) {
    const ip = adresseIpReelle(request);

    // Contrôle ET réservation en un seul appel synchrone, AVANT tout appel
    // asynchrone (argon2.verify est à la fois coûteux en CPU et le seul
    // point de suspension de cette fonction) — voir
    // LimitationTentativesConnexionService.reserverTentative pour pourquoi
    // cet ordre précis importe.
    const controle = this.limitationTentativesConnexionService.reserverTentative(ip, dto.email);
    if (controle.bloque) {
      throw new TropDeTentativesConnexionException(controle.retryAfterSeconds);
    }

    const user = await this.authService.validateUser(dto.email, dto.password);
    if (!user) {
      // Rien à faire : reserverTentative a déjà compté cette tentative.
      throw new UnauthorizedException("Identifiants invalides");
    }

    this.limitationTentativesConnexionService.enregistrerSucces(ip, dto.email);
    return this.authService.login(user);
  }
}
