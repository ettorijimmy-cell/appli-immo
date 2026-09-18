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
import { EvenementsCalendrierModule } from "./evenements-calendrier.module";
import { EvenementsCalendrierService } from "./evenements-calendrier.service";

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  evenementId: string;
}

// Sous-commit 5a (chantier scoping multi-organisation, 2026-09-18) :
// EvenementsCalendrierService.findById() ne vérifiait jusqu'ici jamais
// l'appartenance à l'organisation. organisationId est une colonne
// directe : contrôle par simple comparaison. Aucun autre appelant interne
// (vérifié par grep — seul EvenementsCalendrierController.findOne
// l'appelle ; findAllPourOrganisation(), utilisée par le flux ICS, est un
// chemin distinct qui n'appelle jamais findById()).
describe("EvenementsCalendrierService.findById — contrôle d'appartenance à l'organisation (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let evenementsCalendrierService: EvenementsCalendrierService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Evenements Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `evenements-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `EvenementsScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }

    const evenement = await evenementsCalendrierService.create(user.id, {
      type: "autre",
      titre: `Événement ${suffixe}`,
      dateDebut: "2026-08-15"
    });

    return { organisationId: organisation.id, userId: user.id, evenementId: evenement.id };
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
        EvenementsCalendrierModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    evenementsCalendrierService = moduleRef.get(EvenementsCalendrierService);
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

  it("réussit normalement quand l'événement appartient à l'organisation appelante", async () => {
    const evenement = await contexteOrgA(() => evenementsCalendrierService.findById(orgA.evenementId));
    expect(evenement.id).toBe(orgA.evenementId);
  });

  it("404 sur l'evenementId d'une autre organisation", async () => {
    await expect(contexteOrgB(() => evenementsCalendrierService.findById(orgA.evenementId))).rejects.toThrow(
      NotFoundException
    );
  });

  it("404 sur un evenementId inexistant", async () => {
    await expect(contexteOrgA(() => evenementsCalendrierService.findById(randomUUID()))).rejects.toThrow(
      NotFoundException
    );
  });

  it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
    const evenement = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
      evenementsCalendrierService.findById(orgA.evenementId)
    );
    expect(evenement.id).toBe(orgA.evenementId);
  });
});
