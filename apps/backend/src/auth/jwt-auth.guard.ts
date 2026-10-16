import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JsonWebTokenError, JwtService, NotBeforeError, TokenExpiredError } from "@nestjs/jwt";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "./public.decorator";

// Extraction du jeton depuis l'en-tête Authorization : les deux motifs
// d'échec ("absent" vs "présent mais mal formé") sont distingués pour la
// journalisation (voir CauseEchecAuth ci-dessous) — le simple ?? undefined
// d'origine les confondait.
type ResultatExtractionToken = { token: string } | { cause: "jeton_absent" | "schema_invalide" };

// Causes journalisées en cas d'échec d'authentification (dette consignée
// lors de l'incident JWT de septembre 2026, docs/error-log.md) — jamais le
// jeton lui-même, une seule donnée contextuelle tolérée par cause
// (expiredAt/date, déjà non sensibles : de simples horodatages).
type CauseEchecAuth =
  | { type: "jeton_absent" }
  | { type: "schema_invalide" }
  | { type: "jeton_expire"; expiredAt: string }
  | { type: "jeton_pas_encore_actif"; date: string }
  | { type: "signature_invalide" }
  | { type: "jeton_malforme" }
  | { type: "autre"; nom: string; message: string };

// Enregistrée comme garde globale (APP_GUARD, voir auth.module.ts) : toute
// route protège par défaut, échec sécurisé (voir docs/data-dictionary.md,
// section Authentification) — seules les routes marquées @Public()
// (ex. POST /auth/login) y échappent.
//
// Journalisation des échecs (Logger("Auth"), warn) : un 401 levé par ce
// garde n'est aujourd'hui JAMAIS journalisé par HttpLoggingInterceptor —
// dans le pipeline Nest, les Guards s'exécutent avant les Interceptors, donc
// intercept() n'est jamais appelé quand canActivate() rejette (confirmé par
// test, voir jwt-guard-interceptor-order.spec.ts). La ligne produite ici
// comble ce trou sans déplacer l'intercepteur. Réponse au client inchangée
// (UnauthorizedException générique, sans détail) — seule la journalisation
// serveur est enrichie. Jamais dans le message journalisé : le jeton, une
// partie du jeton, l'en-tête Authorization, le secret, le payload — voir
// CauseEchecAuth ci-dessus pour l'unique exception tolérée (horodatage
// d'expiration/d'activation).
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger("Auth");

  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const extraction = this.extractToken(request);
    if ("cause" in extraction) {
      this.journaliserEchec(request, { type: extraction.cause });
      throw new UnauthorizedException();
    }

    try {
      request.user = await this.jwtService.verifyAsync(extraction.token);
    } catch (err) {
      this.journaliserEchec(request, this.resoudreCauseErreurJwt(err));
      throw new UnauthorizedException();
    }

    return true;
  }

  private extractToken(request: Request): ResultatExtractionToken {
    const header = request.headers.authorization;
    if (!header) {
      return { cause: "jeton_absent" };
    }
    const [type, token] = header.split(" ");
    if (type !== "Bearer" || !token) {
      return { cause: "schema_invalide" };
    }
    return { token };
  }

  // Ordre des tests volontaire : TokenExpiredError et NotBeforeError
  // héritent toutes deux de JsonWebTokenError — les tester en premier,
  // sinon elles tomberaient dans la branche générique (signature_invalide/
  // jeton_malforme/autre) au lieu de leur cause dédiée.
  private resoudreCauseErreurJwt(err: unknown): CauseEchecAuth {
    if (err instanceof TokenExpiredError) {
      return { type: "jeton_expire", expiredAt: err.expiredAt.toISOString() };
    }
    if (err instanceof NotBeforeError) {
      return { type: "jeton_pas_encore_actif", date: err.date.toISOString() };
    }
    if (err instanceof JsonWebTokenError) {
      if (err.message === "invalid signature") {
        return { type: "signature_invalide" };
      }
      if (err.message === "jwt malformed" || err.message === "invalid token") {
        return { type: "jeton_malforme" };
      }
    }
    // Repli générique : nom + message de la bibliothèque jsonwebtoken
    // uniquement (jamais le jeton, voir les messages possibles listés dans
    // verify.js — aucun ne reproduit le jeton ou le secret).
    return {
      type: "autre",
      nom: err instanceof Error ? err.name : "Error",
      message: err instanceof Error ? err.message : String(err)
    };
  }

  private journaliserEchec(request: Request, cause: CauseEchecAuth): void {
    const detail =
      cause.type === "jeton_expire"
        ? ` (expiredAt=${cause.expiredAt})`
        : cause.type === "jeton_pas_encore_actif"
          ? ` (date=${cause.date})`
          : cause.type === "autre"
            ? ` (${cause.nom}: ${cause.message})`
            : "";
    this.logger.warn(`${request.method} ${request.path} ${cause.type}${detail}`);
  }
}
