import { join } from "node:path";
import { Controller, Get, INestApplication, Logger, Module } from "@nestjs/common";
import { APP_GUARD, Reflector } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { monterMobileWeb } from "./mobile-web";

// Fixture statique minimale (index.html + assets/app.js), jamais le vrai
// build de apps/mobile-web — voir __fixtures__/dist-test.
const DIST_FIXTURE = join(__dirname, "__fixtures__", "dist-test");

// Contrôleur de substitution : simule une vraie route d'API protégée par
// JwtAuthGuard (APP_GUARD), exactement comme AppModule le fait en
// production — sert à vérifier qu'une route d'API réelle n'est ni
// contournée ni affectée par le montage de /mobile.
@Controller()
class ControleurApiTest {
  @Get("api-test")
  getApiTest(): { ok: true } {
    return { ok: true };
  }
}

@Module({
  imports: [JwtModule.register({ secret: "test-secret" })],
  controllers: [ControleurApiTest],
  providers: [JwtAuthGuard, Reflector, { provide: APP_GUARD, useExisting: JwtAuthGuard }]
})
class ModuleTest {}

interface AppDeTest {
  app: INestApplication;
  baseUrl: string;
}

async function demarrerApp(envOverrides: Record<string, string | undefined>, distDir = DIST_FIXTURE): Promise<AppDeTest> {
  const cles = Object.keys(envOverrides);
  const valeursOriginales = new Map(cles.map((cle) => [cle, process.env[cle]]));
  for (const cle of cles) {
    const valeur = envOverrides[cle];
    if (valeur === undefined) {
      delete process.env[cle];
    } else {
      process.env[cle] = valeur;
    }
  }

  const moduleRef = await Test.createTestingModule({ imports: [ModuleTest] }).compile();
  const app = moduleRef.createNestApplication();
  // monterMobileWeb() AVANT app.init() — vérifié empiriquement
  // indispensable : une fois le routeur Nest initialisé, toute route non
  // mappée par un contrôleur produit directement un 404 JSON (son propre
  // NotFoundException), qui ne "retombe" jamais sur un middleware ajouté
  // après coup. Reproduit l'ordre exact de main.ts (app.use() entre
  // NestFactory.create() et app.listen(), jamais d'app.init() explicite).
  monterMobileWeb(app, distDir);
  await app.init();
  await app.listen(0);

  // Restaure l'environnement immédiatement après le montage : la lecture
  // par lireConfigVerrouDepuisEnv a déjà eu lieu dans monterMobileWeb, donc
  // ne dépend plus de process.env au-delà de ce point.
  for (const cle of cles) {
    const original = valeursOriginales.get(cle);
    if (original === undefined) {
      delete process.env[cle];
    } else {
      process.env[cle] = original;
    }
  }

  const adresse = app.getHttpServer().address();
  const port = typeof adresse === "object" && adresse ? adresse.port : (() => {
    throw new Error("Port d'écoute introuvable");
  })();

  return { app, baseUrl: `http://127.0.0.1:${port}` };
}

function enTeteBasic(utilisateur: string, motDePasse: string): string {
  return `Basic ${Buffer.from(`${utilisateur}:${motDePasse}`, "utf8").toString("base64")}`;
}

describe("Montage /mobile (verrou + statique + repli SPA) — intégration HTTP réelle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("verrou configuré avec des identifiants valides", () => {
    let appDeTest: AppDeTest;

    beforeEach(async () => {
      appDeTest = await demarrerApp({
        MOBILE_WEB_BASIC_AUTH_ENABLED: undefined,
        MOBILE_WEB_BASIC_AUTH_USER: "proprietaire",
        MOBILE_WEB_BASIC_AUTH_PASSWORD: "secret-correct"
      });
    });

    afterEach(async () => {
      await appDeTest.app.close();
    });

    it("sans identifiants : 401 avec WWW-Authenticate (fenêtre native du navigateur), et déjà la CSP + nosniff", async () => {
      const reponse = await fetch(`${appDeTest.baseUrl}/mobile/`);
      expect(reponse.status).toBe(401);
      expect(reponse.headers.get("www-authenticate")).toContain("Basic");
      // Les en-têtes de sécurité sont posés AVANT le verrou (voir
      // mobile-web.ts) : présents même sur ce 401, pas seulement sur une
      // réponse réussie.
      expect(reponse.headers.get("content-security-policy")).toContain("default-src 'self'");
      expect(reponse.headers.get("x-content-type-options")).toBe("nosniff");
    });

    it("avec les bons identifiants : 200, contenu de index.html (fixture), jamais mis en cache", async () => {
      const reponse = await fetch(`${appDeTest.baseUrl}/mobile/`, {
        headers: { authorization: enTeteBasic("proprietaire", "secret-correct") }
      });
      expect(reponse.status).toBe(200);
      const corps = await reponse.text();
      expect(corps).toContain("fixture-index");
      expect(reponse.headers.get("cache-control")).toBe("no-cache");
      expect(reponse.headers.get("content-security-policy")).toContain("default-src 'self'");
      expect(reponse.headers.get("x-content-type-options")).toBe("nosniff");
    });

    it("un fichier statique réel (/mobile/assets/app.js) est servi tel quel, en cache long et immutable", async () => {
      const reponse = await fetch(`${appDeTest.baseUrl}/mobile/assets/app.js`, {
        headers: { authorization: enTeteBasic("proprietaire", "secret-correct") }
      });
      expect(reponse.status).toBe(200);
      expect(await reponse.text()).toContain("fixture-asset");
      // Nom de fichier à empreinte (voir vite.config.ts) : jamais réutilisé
      // pour un contenu différent, contrairement à index.html ci-dessus.
      expect(reponse.headers.get("cache-control")).toContain("immutable");
      expect(reponse.headers.get("cache-control")).toContain("max-age=31536000");
    });

    it("repli SPA : une route profonde inexistante en tant que fichier renvoie index.html avec 200 (pas 404), jamais mis en cache", async () => {
      const reponse = await fetch(`${appDeTest.baseUrl}/mobile/bail/un-id-quelconque`, {
        headers: { authorization: enTeteBasic("proprietaire", "secret-correct") }
      });
      expect(reponse.status).toBe(200);
      expect(await reponse.text()).toContain("fixture-index");
      expect(reponse.headers.get("cache-control")).toBe("no-cache");
    });

    it("un chemin qui ressemble à un fichier mais n'existe pas (/mobile/assets/ancien-inexistant.js) : 404, jamais le repli SPA", async () => {
      const reponse = await fetch(`${appDeTest.baseUrl}/mobile/assets/ancien-inexistant.js`, {
        headers: { authorization: enTeteBasic("proprietaire", "secret-correct") }
      });
      expect(reponse.status).toBe(404);
      expect(await reponse.text()).not.toContain("fixture-index");
    });

    it("méthode autre que GET/HEAD sur une route de l'appli (/mobile/bail/123) : 405, jamais le repli SPA", async () => {
      const reponse = await fetch(`${appDeTest.baseUrl}/mobile/bail/123`, {
        method: "POST",
        headers: { authorization: enTeteBasic("proprietaire", "secret-correct") }
      });
      expect(reponse.status).toBe(405);
      expect(reponse.headers.get("allow")).toContain("GET");
      expect(await reponse.text()).not.toContain("fixture-index");
    });

    it("HEAD sur une route de l'appli : traité comme GET, repli SPA (200)", async () => {
      const reponse = await fetch(`${appDeTest.baseUrl}/mobile/bail/123`, {
        method: "HEAD",
        headers: { authorization: enTeteBasic("proprietaire", "secret-correct") }
      });
      expect(reponse.status).toBe(200);
    });

    it("mauvais identifiants : 401, jamais le contenu de l'appli", async () => {
      const reponse = await fetch(`${appDeTest.baseUrl}/mobile/`, {
        headers: { authorization: enTeteBasic("proprietaire", "mauvais-mot-de-passe") }
      });
      expect(reponse.status).toBe(401);
    });

    it("aucune collision : /api-test (route d'API réelle) reste gouvernée par JwtAuthGuard, jamais par le verrou /mobile", async () => {
      const reponse = await fetch(`${appDeTest.baseUrl}/api-test`);
      expect(reponse.status).toBe(401);
      // Le verrou /mobile n'intervient jamais ici : pas de WWW-Authenticate
      // Basic sur le 401 de l'API (sinon le navigateur afficherait la
      // fenêtre native Basic Auth sur une simple erreur d'API).
      expect(reponse.headers.get("www-authenticate")).toBeNull();
    });

    it("JwtAuthGuard répond normalement avec un jeton valide sur /api-test (l'ajout de /mobile n'a rien changé)", async () => {
      const jwtService = appDeTest.app.get(await import("@nestjs/jwt").then((m) => m.JwtService));
      const jeton = jwtService.sign({ sub: "test" });
      const reponse = await fetch(`${appDeTest.baseUrl}/api-test`, {
        headers: { authorization: `Bearer ${jeton}` }
      });
      expect(reponse.status).toBe(200);
      expect(await reponse.json()).toEqual({ ok: true });
    });
  });

  describe("verrou désactivé (MOBILE_WEB_BASIC_AUTH_ENABLED=false)", () => {
    let appDeTest: AppDeTest;

    beforeEach(async () => {
      appDeTest = await demarrerApp({
        MOBILE_WEB_BASIC_AUTH_ENABLED: "false",
        MOBILE_WEB_BASIC_AUTH_USER: undefined,
        MOBILE_WEB_BASIC_AUTH_PASSWORD: undefined
      });
    });

    afterEach(async () => {
      await appDeTest.app.close();
    });

    it("sert /mobile sans aucun en-tête d'autorisation", async () => {
      const reponse = await fetch(`${appDeTest.baseUrl}/mobile/`);
      expect(reponse.status).toBe(200);
      expect(await reponse.text()).toContain("fixture-index");
    });
  });

  describe("verrou actif mais mal configuré (identifiants absents)", () => {
    let appDeTest: AppDeTest;
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      appDeTest = await demarrerApp({
        MOBILE_WEB_BASIC_AUTH_ENABLED: undefined,
        MOBILE_WEB_BASIC_AUTH_USER: undefined,
        MOBILE_WEB_BASIC_AUTH_PASSWORD: undefined
      });
    });

    afterEach(async () => {
      await appDeTest.app.close();
    });

    it("/mobile répond 503 avec un message clair, jamais une exception, sans tenter de comparer d'identifiants", async () => {
      const reponse = await fetch(`${appDeTest.baseUrl}/mobile/`);
      expect(reponse.status).toBe(503);
      const corps = (await reponse.json()) as { message: string };
      expect(corps.message).toMatch(/indisponible/i);
      expect(warnSpy).not.toHaveBeenCalled();
      // Posés avant le verrou (voir mobile-web.ts) : présents même sur ce
      // 503, pas seulement sur une réponse réussie ou le 401 du verrou.
      expect(reponse.headers.get("content-security-policy")).toContain("default-src 'self'");
      expect(reponse.headers.get("x-content-type-options")).toBe("nosniff");
    });

    it("l'API continue de fonctionner normalement malgré le verrou mal configuré", async () => {
      const reponse = await fetch(`${appDeTest.baseUrl}/api-test`);
      expect(reponse.status).toBe(401); // JwtAuthGuard, inchangé — pas de 503
    });
  });

  describe("build mobile-web absent (index.html manquant)", () => {
    let appDeTest: AppDeTest;

    beforeEach(async () => {
      appDeTest = await demarrerApp(
        {
          MOBILE_WEB_BASIC_AUTH_ENABLED: "false",
          MOBILE_WEB_BASIC_AUTH_USER: undefined,
          MOBILE_WEB_BASIC_AUTH_PASSWORD: undefined
        },
        join(__dirname, "__fixtures__", "dist-inexistant")
      );
    });

    afterEach(async () => {
      await appDeTest.app.close();
    });

    it("503 explicite plutôt qu'une exception non gérée", async () => {
      const reponse = await fetch(`${appDeTest.baseUrl}/mobile/route-quelconque`);
      expect(reponse.status).toBe(503);
    });

    it("X-Content-Type-Options reste posé même sans index.html (CSP introuvable, pas d'exception)", async () => {
      const reponse = await fetch(`${appDeTest.baseUrl}/mobile/route-quelconque`);
      expect(reponse.headers.get("x-content-type-options")).toBe("nosniff");
      expect(reponse.headers.get("content-security-policy")).toBeNull();
    });
  });
});
