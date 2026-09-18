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
import { SinistresModule } from "./sinistres.module";
import { SinistresService } from "./sinistres.service";

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  sinistreId: string;
}

// Sous-commit 5a (chantier scoping multi-organisation, 2026-09-18) :
// SinistresService.findById() ne vérifiait jusqu'ici jamais l'appartenance
// à l'organisation. organisationId est une colonne directe : contrôle par
// simple comparaison. Aucun autre appelant interne (vérifié par grep —
// seul SinistresController.findOne l'appelle).
describe("SinistresService.findById — contrôle d'appartenance à l'organisation (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let sinistresService: SinistresService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Sinistres Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `sinistres-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `SinistresScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }

    const sinistre = await sinistresService.create(user.id, {
      type: "degat_eaux",
      dateDeclaration: "2026-08-15"
    });

    return { organisationId: organisation.id, userId: user.id, sinistreId: sinistre.id };
  }

  beforeEach(async () => {
    db = await begin();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        CommonModule,
        DatabaseModule,
        UsersModule,
        AuthModule,
        SinistresModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    sinistresService = moduleRef.get(SinistresService);
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

  it("réussit normalement quand le sinistre appartient à l'organisation appelante", async () => {
    const sinistre = await contexteOrgA(() => sinistresService.findById(orgA.sinistreId));
    expect(sinistre.id).toBe(orgA.sinistreId);
  });

  it("404 sur le sinistreId d'une autre organisation", async () => {
    await expect(contexteOrgB(() => sinistresService.findById(orgA.sinistreId))).rejects.toThrow(
      NotFoundException
    );
  });

  it("404 sur un sinistreId inexistant", async () => {
    await expect(contexteOrgA(() => sinistresService.findById(randomUUID()))).rejects.toThrow(NotFoundException);
  });

  it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
    const sinistre = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
      sinistresService.findById(orgA.sinistreId)
    );
    expect(sinistre.id).toBe(orgA.sinistreId);
  });
});
