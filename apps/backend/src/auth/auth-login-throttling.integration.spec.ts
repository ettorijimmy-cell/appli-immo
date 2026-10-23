import { randomUUID } from "crypto";
import { UnauthorizedException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { Test, type TestingModule } from "@nestjs/testing";
import * as argon2 from "argon2";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, utilisateurs, type Database } from "db";
import type { Request } from "express";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { LimitationTentativesConnexionService, SEUIL_ECHECS_IP } from "./limitation-tentatives-connexion.service";
import { TropDeTentativesConnexionException } from "./trop-de-tentatives-connexion.exception";

function requeteDepuisIp(ip: string): Request {
  return { headers: { "x-real-ip": ip }, ip } as unknown as Request;
}

// Même dispositif que auth.integration.spec.ts (vrai Postgres
// transactionnel, voir ce fichier pour le détail) — fichier séparé car il
// exerce AuthController (vérification du seuil AVANT argon2), pas
// seulement AuthService.
describe("AuthController — limitation des tentatives de connexion (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let controller: AuthController;
  let db: Database;

  const password = "mot-de-passe-integration";
  let email: string;

  beforeEach(async () => {
    db = await begin();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        DatabaseModule,
        UsersModule,
        JwtModule.register({ secret: "integration-test-secret", signOptions: { expiresIn: 3600 } })
      ],
      controllers: [AuthController],
      providers: [AuthService, LimitationTentativesConnexionService]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    controller = moduleRef.get(AuthController);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Intégration CI" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }

    email = `integration-throttling-${randomUUID()}@example.com`;
    await db.insert(utilisateurs).values({
      organisationId: organisation.id,
      email,
      nom: "Test",
      prenom: "Intégration",
      motDePasseHash: await argon2.hash(password),
      statut: "actif"
    });
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  it("rejette toujours les mauvais identifiants avant le seuil (comportement inchangé)", async () => {
    await expect(controller.login({ email, password: "faux" }, requeteDepuisIp("198.51.100.1"))).rejects.toThrow(
      "Identifiants invalides"
    );
  });

  it(`bloque avec un 429 après ${SEUIL_ECHECS_IP} échecs depuis la même IP, même avec le bon mot de passe ensuite`, async () => {
    const ip = "198.51.100.2";
    for (let i = 0; i < SEUIL_ECHECS_IP; i++) {
      await expect(controller.login({ email, password: "faux" }, requeteDepuisIp(ip))).rejects.toThrow(
        "Identifiants invalides"
      );
    }

    await expect(controller.login({ email, password: "faux" }, requeteDepuisIp(ip))).rejects.toThrow(
      TropDeTentativesConnexionException
    );
    // Bloqué avant toute vérification argon2, même avec le bon mot de passe.
    await expect(controller.login({ email, password }, requeteDepuisIp(ip))).rejects.toThrow(
      TropDeTentativesConnexionException
    );
  });

  it("une connexion réussie remet à zéro le compteur IP (nouvel échec non bloquant juste après)", async () => {
    const ip = "198.51.100.3";
    for (let i = 0; i < SEUIL_ECHECS_IP - 1; i++) {
      await expect(controller.login({ email, password: "faux" }, requeteDepuisIp(ip))).rejects.toThrow();
    }

    await expect(controller.login({ email, password }, requeteDepuisIp(ip))).resolves.toEqual({
      accessToken: expect.any(String)
    });

    await expect(controller.login({ email, password: "faux" }, requeteDepuisIp(ip))).rejects.toThrow(
      "Identifiants invalides"
    );
  });

  it(`sous Promise.all, seules les ${SEUIL_ECHECS_IP} premières tentatives atteignent validateUser — les suivantes sont bloquées en 429 sans jamais y arriver`, async () => {
    const ip = "198.51.100.4";
    const nombreAppelsParalleles = 12;
    const authService = moduleRef.get(AuthService);
    const validateUserSpy = vi.spyOn(authService, "validateUser");

    const resultats = await Promise.allSettled(
      Array.from({ length: nombreAppelsParalleles }, () =>
        controller.login({ email, password: "faux" }, requeteDepuisIp(ip))
      )
    );

    const rejets = resultats
      .filter((resultat): resultat is PromiseRejectedResult => resultat.status === "rejected")
      .map((resultat) => resultat.reason);
    const rejetsIdentifiantsInvalides = rejets.filter((erreur) => erreur instanceof UnauthorizedException);
    const rejets429 = rejets.filter((erreur) => erreur instanceof TropDeTentativesConnexionException);

    // La garantie testée : le nombre d'appels qui atteignent réellement
    // validateUser() (donc argon2.verify) est borné par le seuil, même
    // lancés tous en même temps — c'est exactement le scénario qui
    // contournait la limite avant la correction (contrôle et comptage
    // séparés par un `await`).
    expect(validateUserSpy).toHaveBeenCalledTimes(SEUIL_ECHECS_IP);
    expect(rejetsIdentifiantsInvalides).toHaveLength(SEUIL_ECHECS_IP);
    expect(rejets429).toHaveLength(nombreAppelsParalleles - SEUIL_ECHECS_IP);
  });
});
