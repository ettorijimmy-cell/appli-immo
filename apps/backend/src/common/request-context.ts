import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable } from "@nestjs/common";

interface ContexteRequete {
  utilisateurId: string | null;
}

const stockageContexte = new AsyncLocalStorage<ContexteRequete>();

/**
 * Capture l'utilisateur authentifié une seule fois par requête HTTP
 * (UserContextInterceptor), pour que les services n'aient pas à le
 * recevoir en paramètre explicite à chaque appel — voir
 * mettreAJourAvecAudit (packages/db) qui le consomme via getUtilisateurId().
 * Hors requête HTTP (tests d'intégration, scripts), getUtilisateurId()
 * renvoie simplement null.
 */
@Injectable()
export class RequestContextService {
  executerAvecContexte<T>(contexte: ContexteRequete, callback: () => T): T {
    return stockageContexte.run(contexte, callback);
  }

  getUtilisateurId(): string | null {
    return stockageContexte.getStore()?.utilisateurId ?? null;
  }
}
