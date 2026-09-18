import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable } from "@nestjs/common";

interface ContexteRequete {
  utilisateurId: string | null;
  // organisationId ajouté le 2026-09-18 (chantier scoping
  // multi-organisation, Commit 2) : posé directement depuis
  // request.user.organisationId (JWT décodé par JwtAuthGuard, voir
  // Commit 1) — jamais un lookup DB, contrairement à l'ancien pattern
  // getUtilisateurId() + UsersService.findById() répété service par
  // service. Optionnel pour ne pas casser les ~15 tests d'intégration
  // existants qui appellent executerAvecContexte({ utilisateurId })
  // sans organisationId (aucun n'en a besoin aujourd'hui, ce commit ne
  // migre aucun service) — absent équivaut à null.
  organisationId?: string | null;
}

const stockageContexte = new AsyncLocalStorage<ContexteRequete>();

/**
 * Capture l'utilisateur authentifié une seule fois par requête HTTP
 * (UserContextInterceptor), pour que les services n'aient pas à le
 * recevoir en paramètre explicite à chaque appel — voir
 * mettreAJourAvecAudit (packages/db) qui le consomme via getUtilisateurId().
 * Hors requête HTTP (tests d'intégration, scripts), getUtilisateurId()/
 * getOrganisationId() renvoient simplement null.
 */
@Injectable()
export class RequestContextService {
  executerAvecContexte<T>(contexte: ContexteRequete, callback: () => T): T {
    return stockageContexte.run(contexte, callback);
  }

  getUtilisateurId(): string | null {
    return stockageContexte.getStore()?.utilisateurId ?? null;
  }

  getOrganisationId(): string | null {
    return stockageContexte.getStore()?.organisationId ?? null;
  }
}
