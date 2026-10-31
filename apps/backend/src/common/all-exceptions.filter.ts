import { Catch, HttpException, Logger, type ArgumentsHost } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";

// Filet de journalisation global (voir docs/error-log.md, [2026-10-31]) :
// sans ce filtre, une exception INATTENDUE (jamais levée volontairement
// en HttpException — une ligne de code qui plante, pas une règle métier)
// n'a aucune garantie explicite d'être journalisée avec sa cause et sa
// pile avant que la réponse 500 générique ne soit envoyée — observé en
// pratique : une requête en échec ne laissait dans les logs que la ligne
// de HttpLoggingInterceptor ("ERROR [HTTP] ... 500 ...ms"), qui ne connaît
// que le code de statut final (événement "finish" de la réponse), jamais
// l'exception elle-même.
//
// Étend BaseExceptionFilter (comportement HTTP par défaut de NestJS,
// jamais changé ici — mêmes codes de statut, mêmes corps de réponse)
// plutôt que de le réimplémenter : seule différence, la journalisation
// explicite AVANT de déléguer. Une HttpException levée volontairement
// (ConflictException, UnprocessableEntityException...) n'est jamais
// "inattendue" — son message est déjà pensé pour le client, jamais
// rejournalisée ici en double.
//
// Jamais de donnée sensible dans ce qui est journalisé : exception.stack
// ne contient ni secret ni corps de requête pour aucune erreur métier de
// ce backend (vérifié au cas par cas — GotenbergService notamment,
// jamais d'identifiant Basic Auth dans un message d'erreur).
//
// Enregistré via app.useGlobalFilters(...) dans main.ts, jamais par
// APP_FILTER dans un module : BaseExceptionFilter a besoin du
// HttpAdapterHost résolu, disponible seulement une fois l'application
// créée (recette officielle NestJS pour ce cas précis).
@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  private readonly logger = new Logger("UnhandledException");

  catch(exception: unknown, host: ArgumentsHost): void {
    if (!(exception instanceof HttpException)) {
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
        exception instanceof Error ? exception.stack : undefined
      );
    }
    super.catch(exception, host);
  }
}
