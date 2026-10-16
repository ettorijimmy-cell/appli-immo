import { Logger, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JwtAuthGuard } from "./jwt-auth.guard";

function creerContexte(
  headers: Record<string, string>,
  requete: { method?: string; path?: string } = {}
): ExecutionContext {
  const request = { headers, method: requete.method ?? "GET", path: requete.path ?? "/scis", user: undefined };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => vi.fn(),
    getClass: () => vi.fn()
  } as unknown as ExecutionContext;
}

describe("JwtAuthGuard", () => {
  const jwtService = new JwtService({ secret: "test-secret" });
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function dernierMessageJournalise(): string {
    const appel = warnSpy.mock.calls.at(-1);
    return appel?.[0] as string;
  }

  it("laisse passer une route décorée @Public() sans vérifier de token, sans rien journaliser", async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(true) } as unknown as Reflector;
    const guard = new JwtAuthGuard(jwtService, reflector);

    await expect(guard.canActivate(creerContexte({}))).resolves.toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("accepte un token valide et pose request.user, sans rien journaliser", async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    const guard = new JwtAuthGuard(jwtService, reflector);
    const token = jwtService.sign({ sub: "utilisateur-test", email: "test@example.com" });
    const context = creerContexte({ authorization: `Bearer ${token}` });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    const request = context.switchToHttp().getRequest<{ user?: { sub: string } }>();
    expect(request.user?.sub).toBe("utilisateur-test");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  describe("journalisation des échecs (un cas par cause)", () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;

    it("jeton_absent : aucun en-tête Authorization", async () => {
      const guard = new JwtAuthGuard(jwtService, reflector);
      const context = creerContexte({}, { method: "GET", path: "/scis" });

      await expect(guard.canActivate(context)).rejects.toThrow("Unauthorized");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(dernierMessageJournalise()).toBe("GET /scis jeton_absent");
    });

    it("schema_invalide : en-tête présent mais pas « Bearer <jeton> » (autre schéma)", async () => {
      const guard = new JwtAuthGuard(jwtService, reflector);
      const context = creerContexte({ authorization: "Basic dXNlcjpwYXNz" }, { method: "POST", path: "/baux" });

      await expect(guard.canActivate(context)).rejects.toThrow("Unauthorized");
      expect(dernierMessageJournalise()).toBe("POST /baux schema_invalide");
    });

    it("schema_invalide : en-tête « Bearer » sans jeton après", async () => {
      const guard = new JwtAuthGuard(jwtService, reflector);
      const context = creerContexte({ authorization: "Bearer" }, { method: "GET", path: "/scis" });

      await expect(guard.canActivate(context)).rejects.toThrow("Unauthorized");
      expect(dernierMessageJournalise()).toBe("GET /scis schema_invalide");
    });

    it("jeton_expire : expiredAt journalisé (ISO), jamais le jeton", async () => {
      const guard = new JwtAuthGuard(jwtService, reflector);
      const token = jwtService.sign({ sub: "x" }, { expiresIn: -10 });
      const context = creerContexte({ authorization: `Bearer ${token}` }, { method: "GET", path: "/scis" });

      await expect(guard.canActivate(context)).rejects.toThrow("Unauthorized");
      const message = dernierMessageJournalise();
      expect(message).toMatch(/^GET \/scis jeton_expire \(expiredAt=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\)$/);
      expect(message).not.toContain(token);
    });

    it("jeton_pas_encore_actif : date journalisée (ISO), jamais le jeton", async () => {
      const guard = new JwtAuthGuard(jwtService, reflector);
      const token = jwtService.sign({ sub: "x" }, { notBefore: 60 });
      const context = creerContexte({ authorization: `Bearer ${token}` }, { method: "GET", path: "/scis" });

      await expect(guard.canActivate(context)).rejects.toThrow("Unauthorized");
      const message = dernierMessageJournalise();
      expect(message).toMatch(/^GET \/scis jeton_pas_encore_actif \(date=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\)$/);
      expect(message).not.toContain(token);
    });

    it("signature_invalide : jeton signé avec un autre secret, jamais le jeton journalisé", async () => {
      const guard = new JwtAuthGuard(jwtService, reflector);
      const autreJwtService = new JwtService({ secret: "secret-different" });
      const token = autreJwtService.sign({ sub: "x" });
      const context = creerContexte({ authorization: `Bearer ${token}` }, { method: "GET", path: "/scis" });

      await expect(guard.canActivate(context)).rejects.toThrow("Unauthorized");
      const message = dernierMessageJournalise();
      expect(message).toBe("GET /scis signature_invalide");
      expect(message).not.toContain(token);
    });

    it("jeton_malforme : chaîne qui n'a pas la structure d'un JWT, jamais le jeton journalisé", async () => {
      const guard = new JwtAuthGuard(jwtService, reflector);
      const tokenInvalide = "ceci-nest-pas-un-jwt";
      const context = creerContexte(
        { authorization: `Bearer ${tokenInvalide}` },
        { method: "GET", path: "/scis" }
      );

      await expect(guard.canActivate(context)).rejects.toThrow("Unauthorized");
      const message = dernierMessageJournalise();
      expect(message).toBe("GET /scis jeton_malforme");
      expect(message).not.toContain(tokenInvalide);
    });

    it("autre : erreur inattendue de verifyAsync, seuls err.name/err.message journalisés, jamais le jeton", async () => {
      const guard = new JwtAuthGuard(jwtService, reflector);
      vi.spyOn(jwtService, "verifyAsync").mockRejectedValueOnce(new Error("Panne réseau inattendue"));
      const token = "un-jeton-qui-naurait-jamais-du-etre-journalise";
      const context = creerContexte({ authorization: `Bearer ${token}` }, { method: "GET", path: "/scis" });

      await expect(guard.canActivate(context)).rejects.toThrow("Unauthorized");
      const message = dernierMessageJournalise();
      expect(message).toBe("GET /scis autre (Error: Panne réseau inattendue)");
      expect(message).not.toContain(token);
    });

    it("ne journalise jamais l'en-tête Authorization complet, quelle que soit la cause", async () => {
      const guard = new JwtAuthGuard(jwtService, reflector);
      const context = creerContexte(
        { authorization: "Bearer jeton-tres-sensible-ne-doit-jamais-apparaitre" },
        { method: "GET", path: "/scis" }
      );

      await expect(guard.canActivate(context)).rejects.toThrow("Unauthorized");
      const message = dernierMessageJournalise();
      expect(message).not.toContain("Authorization");
      expect(message).not.toContain("Bearer");
      expect(message).not.toContain("jeton-tres-sensible-ne-doit-jamais-apparaitre");
    });

    it("la réponse au client reste un 401 générique, sans détail, quelle que soit la cause", async () => {
      const guard = new JwtAuthGuard(jwtService, reflector);
      const context = creerContexte({}, { method: "GET", path: "/scis" });

      try {
        await guard.canActivate(context);
        expect.unreachable("canActivate devait rejeter");
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        const reponse = (err as { getResponse?: () => unknown }).getResponse?.();
        expect((err as Error).message).toBe("Unauthorized");
        expect(reponse).not.toHaveProperty("cause");
      }
    });
  });
});
