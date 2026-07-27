import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { RequestContextService } from "./request-context";
import { UserContextInterceptor } from "./user-context.interceptor";

// Global : le contexte requête est une préoccupation transversale
// (comme AuthModule/JwtAuthGuard, voir auth.module.ts), consommée par tous
// les services qui écrivent via mettreAJourAvecAudit (packages/db).
@Global()
@Module({
  providers: [RequestContextService, { provide: APP_INTERCEPTOR, useClass: UserContextInterceptor }],
  exports: [RequestContextService]
})
export class CommonModule {}
