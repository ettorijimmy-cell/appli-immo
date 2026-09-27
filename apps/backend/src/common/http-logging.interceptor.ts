import { Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import type { Request, Response } from "express";
import type { Observable } from "rxjs";

// Seule source de journalisation des requêtes HTTP de ce backend (voir
// docs/error-log.md, [2026-09-27]) : ce backend n'a par ailleurs aucun
// logging d'accès, et NestJS ne journalise jamais par défaut une exception
// "attendue" (4xx) — seulement les 5xx/non gérées. Écoute l'événement
// "finish" de la réponse plutôt qu'un opérateur RxJS sur next.handle() :
// le filtre d'exception global de Nest fixe le code de statut final APRÈS
// que la chaîne d'intercepteurs se soit résolue (y compris pour une
// exception non gérée levée par le contrôleur) — "finish" est le seul
// point où response.statusCode est garanti définitif dans tous les cas,
// succès comme erreur.
// Jamais de corps de requête, d'en-têtes ni de paramètres de requête dans
// le message journalisé — uniquement méthode + chemin (request.path,
// jamais l'URL complète avec sa query string) + statut + durée.
@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger("HTTP");

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const debut = Date.now();
    const { method, path } = request;

    response.on("finish", () => {
      const duree = Date.now() - debut;
      const { statusCode } = response;
      const message = `${method} ${path} ${statusCode} ${duree}ms`;
      if (statusCode >= 500) {
        this.logger.error(message);
      } else if (statusCode >= 400) {
        this.logger.warn(message);
      } else {
        this.logger.log(message);
      }
    });

    return next.handle();
  }
}
