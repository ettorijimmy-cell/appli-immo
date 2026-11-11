import { randomUUID } from "crypto";
import { Controller, Get, INestApplication, Logger, Module, ValidationPipe } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HttpAdapterHost } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import * as argon2 from "argon2";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, utilisateurs, type Database } from "db";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthModule } from "../auth/auth.module";
import { SEUIL_ECHECS_IP } from "../auth/limitation-tentatives-connexion.service";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { AllExceptionsFilter } from "./all-exceptions.filter";
import { CommonModule } from "./common.module";

// Hash du mot de passe de test à coût argon2id réduit : le test du 429
// vérifie le comptage des tentatives et la réponse du filtre, pas le coût
// du hash. argon2.verify relit les paramètres dans le hash, donc chaque
// vérification devient quasi instantanée ; le code de production
// (AuthService, paramètres par défaut) n'est pas modifié. Avec les
// paramètres par défaut, un hash ou une vérification coûte environ 250 ms
// sur le poste de dev, et le 429 (6 connexions HTTP) dépassait le défaut
// Vitest (5000ms) sous la charge de la suite complète (audit du
// 2026-11-11, tmp/).
const PARAMETRES_ARGON2_TEST = { type: argon2.argon2id, memoryCost: 1024, timeCost: 1, parallelism: 1 } as const;

// Jamais une route réelle de production : sert uniquement à provoquer une
// exception VRAIMENT inattendue (jamais une HttpException), au même titre
// que ControleurApiTest dans mobile-web.spec.ts — même convention pour ce
// genre de test (aucune infrastructure supertest dans ce backend, voir
// app.module.spec.ts : "real HTTP" via createNestApplication()/app.listen(),
// comme mobile-web.spec.ts). Protégée par JwtAuthGuard comme toute route
// réelle (global via AuthModule, APP_GUARD) : sert aussi à vérifier le 401.
@Controller("diag-exceptions-test")
class ControleurDiagnosticTest {
  @Get("inattendue")
  leverErreurInattendue(): never {
    throw new Error("Erreur de test jamais typée en HttpException — jamais un vrai comportement métier.");
  }
}

@Module({ controllers: [ControleurDiagnosticTest] })
class ModuleDiagnosticTest {}

interface AppDeTest {
  app: INestApplication;
  baseUrl: string;
}

// Reproduit EXACTEMENT la séquence de bootstrap() (main.ts) pertinente ici
// — ValidationPipe puis AllExceptionsFilter, dans le même ordre — pour que
// ce test engage le VRAI filtre global tel qu'il tourne réellement, jamais
// une reconstruction approximative.
async function demarrerApp(db: Database): Promise<AppDeTest> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      CommonModule,
      DatabaseModule,
      UsersModule,
      AuthModule,
      ModuleDiagnosticTest
    ]
  })
    .overrideProvider(DATABASE_CONNECTION)
    .useValue(db)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new AllExceptionsFilter(httpAdapter));
  await app.init();
  await app.listen(0);

  const adresse = app.getHttpServer().address();
  const port =
    typeof adresse === "object" && adresse
      ? adresse.port
      : (() => {
          throw new Error("Port d'écoute introuvable");
        })();
  return { app, baseUrl: `http://127.0.0.1:${port}` };
}

async function obtenirJeton(baseUrl: string, email: string, password: string): Promise<string> {
  const reponse = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const corps = (await reponse.json()) as { accessToken: string };
  return corps.accessToken;
}

// Non-régression (chantier PDF étape 4b, 2026-10-31) : AllExceptionsFilter
// ne doit RIEN changer aux réponses HTTP existantes — seulement ajouter une
// journalisation explicite pour les exceptions vraiment inattendues (voir
// son commentaire). Ces 4 cas couvrent les familles de réponses déjà en
// production : filtre scopé méthode (429 + Retry-After), ValidationPipe
// (400), garde globale (401), et le cas que ce filtre vise spécifiquement
// (500 inattendu, cause et pile journalisées).
describe("AllExceptionsFilter — non-régression sur de vraies routes (intégration HTTP réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let db: Database;
  let appDeTest: AppDeTest;
  const password = "mot-de-passe-integration";
  let email: string;

  beforeEach(async () => {
    db = await begin();
    email = `filtre-exceptions-${randomUUID()}@example.com`;
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation filtre exceptions" })
      .returning();
    await db.insert(utilisateurs).values({
      organisationId: organisation!.id,
      email,
      nom: "Test",
      prenom: "Filtre",
      motDePasseHash: await argon2.hash(password, PARAMETRES_ARGON2_TEST),
      statut: "actif"
    });
    appDeTest = await demarrerApp(db);
  });

  afterEach(async () => {
    await appDeTest?.app.close();
    await rollback();
    // Logger.prototype est un prototype PARTAGÉ par tout le process — même
    // raison que etat-des-lieux-pdf.integration.spec.ts.
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  it("401 sur une route protégée appelée sans jeton — réponse inchangée (garde globale, jamais ce filtre)", async () => {
    const reponse = await fetch(`${appDeTest.baseUrl}/diag-exceptions-test/inattendue`);
    expect(reponse.status).toBe(401);
  });

  it("400 de validation (POST /auth/login sans mot de passe) — même forme de message qu'avant (ValidationPipe, jamais ce filtre)", async () => {
    const reponse = await fetch(`${appDeTest.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email })
    });
    expect(reponse.status).toBe(400);
    const corps = (await reponse.json()) as { statusCode: number; message: unknown; error: string };
    expect(corps.statusCode).toBe(400);
    expect(corps.error).toBe("Bad Request");
    expect(Array.isArray(corps.message)).toBe(true);
  });

  it("429 de /auth/login avec en-tête Retry-After — réponse inchangée (filtre scopé méthode, jamais ce filtre global)", async () => {
    const ip = "198.51.100.9";
    for (let i = 0; i < SEUIL_ECHECS_IP; i++) {
      await fetch(`${appDeTest.baseUrl}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-real-ip": ip },
        body: JSON.stringify({ email, password: "faux" })
      });
    }
    const reponse = await fetch(`${appDeTest.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": ip },
      body: JSON.stringify({ email, password: "faux" })
    });
    expect(reponse.status).toBe(429);
    expect(reponse.headers.get("retry-after")).not.toBeNull();
  });

  it("500 sur une exception vraiment inattendue — corps de réponse inchangé, cause et pile journalisées (ce filtre, précisément)", async () => {
    const jeton = await obtenirJeton(appDeTest.baseUrl, email, password);
    const errorSpy = vi.spyOn(Logger.prototype, "error");

    const reponse = await fetch(`${appDeTest.baseUrl}/diag-exceptions-test/inattendue`, {
      headers: { Authorization: `Bearer ${jeton}` }
    });

    expect(reponse.status).toBe(500);
    const corps = await reponse.json();
    // Forme standard NestJS pour une exception non typée — jamais changée
    // par ce filtre (délègue intégralement à BaseExceptionFilter).
    expect(corps).toEqual({ statusCode: 500, message: "Internal server error" });
    expect(errorSpy).toHaveBeenCalledWith(
      "Erreur de test jamais typée en HttpException — jamais un vrai comportement métier.",
      expect.stringContaining("Error: Erreur de test")
    );
  });
});
