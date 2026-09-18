import { randomUUID } from "crypto";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, utilisateurs, type Database } from "db";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthModule } from "../auth/auth.module";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { ScisModule } from "./scis.module";
import { ScisService } from "./scis.service";

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  sciId: string;
}

// Sous-commit 5b (chantier scoping multi-organisation, 2026-09-18) :
// ScisService.findById() ne vérifiait jusqu'ici jamais l'appartenance à
// l'organisation. scis n'a pas de colonne organisationId directe — le
// contrôle passe par organisation_sci, même chemin que findAll(). Aucun
// autre appelant interne (vérifié par grep — seul ScisController.findOne
// l'appelle ; DocumentsService résout sci/organisation_sci par ses
// propres requêtes, sans jamais appeler ScisService.findById()).
describe("ScisService.findById — contrôle d'appartenance à l'organisation (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let scisService: ScisService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Scis Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `scis-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `ScisScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }

    const sci = await scisService.create(user.id, {
      nom: `SCI Scoping ${suffixe}`,
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });

    return { organisationId: organisation.id, userId: user.id, sciId: sci.id };
  }

  beforeEach(async () => {
    db = await begin();

    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), CommonModule, DatabaseModule, UsersModule, AuthModule, ScisModule]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    requestContextService = moduleRef.get(RequestContextService);

    orgA = await creerFixtureOrganisation("A");
    orgB = await creerFixtureOrganisation("B");
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  function contexteOrgA<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte({ utilisateurId: orgA.userId, organisationId: orgA.organisationId }, fn);
  }
  function contexteOrgB<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte({ utilisateurId: orgB.userId, organisationId: orgB.organisationId }, fn);
  }

  it("réussit normalement quand la SCI appartient à l'organisation appelante", async () => {
    const sci = await contexteOrgA(() => scisService.findById(orgA.sciId));
    expect(sci.id).toBe(orgA.sciId);
  });

  it("404 sur le sciId d'une autre organisation", async () => {
    await expect(contexteOrgB(() => scisService.findById(orgA.sciId))).rejects.toThrow(NotFoundException);
  });

  it("404 sur un sciId inexistant", async () => {
    await expect(contexteOrgA(() => scisService.findById(randomUUID()))).rejects.toThrow(NotFoundException);
  });

  it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
    const sci = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
      scisService.findById(orgA.sciId)
    );
    expect(sci.id).toBe(orgA.sciId);
  });
});
