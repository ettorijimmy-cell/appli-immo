import { Injectable, UnauthorizedException, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
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
    // organisationId lu directement depuis le JWT décodé (request.user,
    // posé par JwtAuthGuard) — jamais un lookup DB ici (voir Commit 1,
    // AuthService.login).
    const organisationId = request.user?.organisationId ?? null;
    // Mitigation (2026-09-18, chantier scoping multi-organisation,
    // Commit 3) : un utilisateurId authentifié sans organisationId ne
    // peut provenir que d'un JWT émis avant le Commit 1 et encore valide
    // pendant sa fenêtre de validité restante (~1h). Avant cette
    // mitigation, ce cas retombait silencieusement sur le fallback
    // "toutes organisations" des services migrés (voir findAll() de
    // TachesService, LocatairesService, etc.) — une vraie fuite de
    // données inter-organisations, pas juste un inconfort. On la
    // transforme ici en échec bruyant et bloquant, au plus près de la
    // requête HTTP réelle. Placé ici plutôt que dans
    // RequestContextService.executerAvecContexte() : cette dernière est
    // aussi appelée directement par des dizaines de tests d'intégration
    // qui simulent un utilisateurId seul pour des méthodes qui n'ont
    // rien à voir avec le scoping par organisation (create/update/
    // archive, génération de documents...) — bloquer à ce niveau aurait
    // cassé ces tests sans rapport avec le problème traité ici.
    if (utilisateurId && !organisationId) {
      throw new UnauthorizedException(
        "Session invalide (jeton émis avant une mise à jour de sécurité) — reconnexion nécessaire."
      );
    }
    return this.requestContext.executerAvecContexte({ utilisateurId, organisationId }, () => next.handle());
  }
}
