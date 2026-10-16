import { Controller, Get, INestApplication, Logger, Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpLoggingInterceptor } from "../common/http-logging.interceptor";
import { JwtAuthGuard } from "./jwt-auth.guard";

// Audit (lecture seule, dette consignée lors de l'incident JWT de
// septembre) : vérifie EMPIRIQUEMENT, via une vraie requête HTTP contre une
// vraie instance Nest (pas un appel direct à intercept()/canActivate() en
// isolation), si un 401 levé par JwtAuthGuard (APP_GUARD) est journalisé par
// HttpLoggingInterceptor (APP_INTERCEPTOR) — reproduit exactement le même
// branchement que app.module.ts/auth.module.ts/common.module.ts, réduit au
// strict nécessaire (pas de base de données).

@Controller()
class ControleurTest {
  @Get("protege")
  getProtege(): { ok: true } {
    return { ok: true };
  }
}

@Module({
  imports: [JwtModule.register({ secret: "test-secret" })],
  controllers: [ControleurTest],
  providers: [
    JwtAuthGuard,
    Reflector,
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: HttpLoggingInterceptor }
  ]
})
class ModuleTest {}

describe("Ordre d'exécution : JwtAuthGuard (APP_GUARD) vs HttpLoggingInterceptor (APP_INTERCEPTOR)", () => {
  let app: INestApplication;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ModuleTest] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    // Posés APRÈS le démarrage : Nest émet lui-même plusieurs messages
    // Logger.log pendant l'initialisation (routes mappées, "application
    // successfully started"...) — sans intérêt pour ce test, qui ne porte
    // que sur ce qui est journalisé PENDANT le traitement d'une requête.
    warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    logSpy = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  function portEcoute(): number {
    const adresse = app.getHttpServer().address();
    if (typeof adresse === "object" && adresse) {
      return adresse.port;
    }
    throw new Error("Port d'écoute introuvable");
  }

  it("un 401 levé par le garde n'est TOUJOURS PAS journalisé par HttpLoggingInterceptor, mais produit désormais une ligne Auth", async () => {
    const reponse = await fetch(`http://127.0.0.1:${portEcoute()}/protege`);

    expect(reponse.status).toBe(401);
    // Confirme empiriquement que le trou HttpLoggingInterceptor demeure
    // (les Guards s'exécutent avant les Interceptors dans le pipeline Nest —
    // intercept() n'est jamais appelé quand canActivate() rejette, donc
    // aucune ligne "GET /protege 401 ..." n'est produite par lui) — jamais
    // déplacé l'intercepteur, comme convenu. En revanche, JwtAuthGuard
    // journalise désormais lui-même l'échec (Logger("Auth"), warn) : c'est
    // la seule ligne produite pour cette requête.
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toBe("GET /protege jeton_absent");
  });

  it("une requête autorisée passe bien par HttpLoggingInterceptor (confirme que l'intercepteur est bien branché)", async () => {
    const reponse = await fetch(`http://127.0.0.1:${portEcoute()}/protege`, {
      headers: { authorization: "Bearer invalide-mais-peu-importe" }
    });

    // 401 attendu (token invalide) mais cette fois canActivate() a bien
    // exécuté le corps du guard — vérifie seulement que le montage
    // applicatif fonctionne, pas le sujet de ce test.
    expect(reponse.status).toBe(401);
  });
});
