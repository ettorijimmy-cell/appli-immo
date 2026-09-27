import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { HttpLoggingInterceptor } from "./http-logging.interceptor";
import { RequestContextService } from "./request-context";
import { UserContextInterceptor } from "./user-context.interceptor";

// Global : le contexte requête est une préoccupation transversale
// (comme AuthModule/JwtAuthGuard, voir auth.module.ts), consommée par tous
// les services qui écrivent via mettreAJourAvecAudit (packages/db).
// Ordre déclaré volontairement : plusieurs providers APP_INTERCEPTOR dans le
// même tableau s'exécutent dans l'ordre du tableau, le premier étant le
// plus "extérieur" (son code s'exécute avant tout intercepteur suivant,
// y compris la pose du contexte utilisateur) — HttpLoggingInterceptor
// avant UserContextInterceptor pour que sa mesure de durée englobe bien
// toute la requête, contexte inclus.
@Global()
@Module({
  providers: [
    RequestContextService,
    { provide: APP_INTERCEPTOR, useClass: HttpLoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: UserContextInterceptor }
  ],
  exports: [RequestContextService]
})
export class CommonModule {}
