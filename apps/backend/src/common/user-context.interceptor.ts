import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import type { Request } from "express";
import type { Observable } from "rxjs";
import { RequestContextService } from "./request-context";

// Global (voir CommonModule) : s'exécute après les guards (JwtAuthGuard a
// donc déjà posé req.user quand present), avant le handler et tout le code
// de service en aval — c'est ce qui permet à mettreAJourAvecAudit
// (packages/db) de retrouver l'utilisateur sans qu'il transite par chaque
// signature de méthode.
@Injectable()
export class UserContextInterceptor implements NestInterceptor {
  constructor(private readonly requestContext: RequestContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const utilisateurId = request.user?.sub ?? null;
    return this.requestContext.executerAvecContexte({ utilisateurId }, () => next.handle());
  }
}
