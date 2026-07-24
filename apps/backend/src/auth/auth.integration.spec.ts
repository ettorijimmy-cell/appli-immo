import { randomUUID } from "crypto";
import { ConfigModule } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import * as argon2 from "argon2";
import { organisations, utilisateurs, type Database } from "db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { UsersModule } from "../users/users.module";
import { AuthService } from "./auth.service";

// Tourne contre un vrai Postgres (service CI, voir .github/workflows/ci.yml)
// après application des migrations Drizzle. Nécessite DATABASE_URL dans
// l'environnement — non inclus dans `pnpm test` par défaut (vitest.config.ts
// exclut ce fichier), lancé séparément via `pnpm test:integration`.
describe("AuthService (intégration Postgres réelle)", () => {
  let authService: AuthService;
  let db: Database;

  const password = "mot-de-passe-integration";
  const email = `integration-${randomUUID()}@example.com`;
  const archivedEmail = `integration-archivee-${randomUUID()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        DatabaseModule,
        UsersModule,
        JwtModule.register({
          secret: "integration-test-secret",
          signOptions: { expiresIn: 3600 }
        })
      ],
      providers: [AuthService]
    }).compile();

    authService = moduleRef.get(AuthService);
    db = moduleRef.get(DATABASE_CONNECTION);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Intégration CI" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }

    const motDePasseHash = await argon2.hash(password);

    await db.insert(utilisateurs).values({
      organisationId: organisation.id,
      email,
      nom: "Test",
      prenom: "Intégration",
      motDePasseHash,
      statut: "actif"
    });

    await db.insert(utilisateurs).values({
      organisationId: organisation.id,
      email: archivedEmail,
      nom: "Test",
      prenom: "Archivé",
      motDePasseHash,
      statut: "archive"
    });
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it("valide un utilisateur réel avec le bon mot de passe et émet un JWT exploitable", async () => {
    const user = await authService.validateUser(email, password);
    expect(user).toEqual({ id: expect.any(String), email });

    const { accessToken } = await authService.login(user!);
    const [, payloadSegment] = accessToken.split(".");
    if (!payloadSegment) {
      throw new Error("JWT mal formé : segment payload manquant");
    }
    const payload = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
    expect(payload.email).toBe(email);
    expect(payload.sub).toBe(user!.id);
  });

  it("rejette un mauvais mot de passe contre la vraie table utilisateurs", async () => {
    await expect(authService.validateUser(email, "mauvais-mot-de-passe")).resolves.toBeNull();
  });

  it("rejette un utilisateur archivé même avec le bon mot de passe", async () => {
    await expect(authService.validateUser(archivedEmail, password)).resolves.toBeNull();
  });

  it("rejette un email inconnu", async () => {
    await expect(authService.validateUser(`inconnu-${randomUUID()}@example.com`, password)).resolves.toBeNull();
  });
});
