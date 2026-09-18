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
import { BienModule } from "./bien.module";
import { BienService } from "./bien.service";

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  bienId: string;
}

// Sous-commit 5a (chantier scoping multi-organisation, 2026-09-18) :
// BienService.findById() ne vérifiait jusqu'ici jamais l'appartenance à
// l'organisation. organisationId est une colonne directe de bien : le
// contrôle est une simple comparaison après lecture. Aucun autre appelant
// interne (vérifié par grep — seul BienController.findOne l'appelle).
describe("BienService.findById — contrôle d'appartenance à l'organisation (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let bienService: BienService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Bien Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `bien-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `BienScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }

    const bien = await bienService.create(user.id, {
      type: "maison",
      proprietaireType: "personne_physique",
      nomProprietaire: `Propriétaire ${suffixe}`,
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });

    return { organisationId: organisation.id, userId: user.id, bienId: bien.id };
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
        BienModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    bienService = moduleRef.get(BienService);
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

  it("réussit normalement quand le bien appartient à l'organisation appelante", async () => {
    const bien = await contexteOrgA(() => bienService.findById(orgA.bienId));
    expect(bien.id).toBe(orgA.bienId);
  });

  it("404 sur le bienId d'une autre organisation", async () => {
    await expect(contexteOrgB(() => bienService.findById(orgA.bienId))).rejects.toThrow(NotFoundException);
  });

  it("404 sur un bienId inexistant", async () => {
    await expect(contexteOrgA(() => bienService.findById(randomUUID()))).rejects.toThrow(NotFoundException);
  });

  it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
    const bien = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
      bienService.findById(orgA.bienId)
    );
    expect(bien.id).toBe(orgA.bienId);
  });
});
