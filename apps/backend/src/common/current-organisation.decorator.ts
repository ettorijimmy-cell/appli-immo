import { createParamDecorator, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

// Expose organisationId directement depuis le JWT décodé (request.user,
// posé par JwtAuthGuard) — jamais un lookup DB. Utilisable dans un
// controller (@CurrentOrganisation() organisationId: string) partout où
// un accès explicite est plus lisible qu'un appel implicite à
// RequestContextService.getOrganisationId() (voir ce service pour
// l'équivalent côté couche service, notamment dans les méthodes déjà
// appelées ailleurs sans traverser un controller).
//
// Ne devrait jamais être utilisé sur une route @Public() : ces routes ne
// passent pas par JwtAuthGuard, donc request.user est absent — l'erreur
// explicite ci-dessous vaut mieux qu'un organisationId undefined qui
// filtrerait silencieusement une requête sur "undefined".
// Extraite de createParamDecorator pour rester testable directement (même
// principe que JwtAuthGuard.canActivate, voir jwt-auth.guard.spec.ts) —
// createParamDecorator ne renvoie qu'un décorateur de paramètre, pas la
// logique elle-même.
export function resoudreOrganisationCourante(ctx: ExecutionContext): string {
  const request = ctx.switchToHttp().getRequest<Request>();
  if (!request.user) {
    throw new UnauthorizedException();
  }
  return request.user.organisationId;
}

export const CurrentOrganisation = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => resoudreOrganisationCourante(ctx)
);
