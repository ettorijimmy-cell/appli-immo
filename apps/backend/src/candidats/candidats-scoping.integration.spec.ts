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
import { LocatairesModule } from "../locataires/locataires.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { CandidatsModule } from "./candidats.module";
import { CandidatsService } from "./candidats.service";

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  candidatId: string;
}

// Sous-commit 5a (chantier scoping multi-organisation, 2026-09-18) :
// CandidatsService.findById() ne vérifiait jusqu'ici jamais l'appartenance
// à l'organisation. organisationId est une colonne directe : contrôle par
// simple comparaison. Aucun autre appelant interne (vérifié par grep —
// seul CandidatsController.findOne l'appelle). N'affecte PAS
// convertirEnLocataire() : cette méthode refait sa propre requête brute
// sur candidatId, sans jamais appeler this.findById() (Catégorie C, hors
// périmètre de ce sous-commit).
describe("CandidatsService.findById — contrôle d'appartenance à l'organisation (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let candidatsService: CandidatsService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Candidats Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `candidats-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `CandidatsScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }

    const candidat = await candidatsService.create(user.id, { nom: "Petit", prenom: `Julien${suffixe}` });

    return { organisationId: organisation.id, userId: user.id, candidatId: candidat.id };
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
        LocatairesModule,
        CandidatsModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    candidatsService = moduleRef.get(CandidatsService);
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

  it("réussit normalement quand le candidat appartient à l'organisation appelante", async () => {
    const candidat = await contexteOrgA(() => candidatsService.findById(orgA.candidatId));
    expect(candidat.id).toBe(orgA.candidatId);
  });

  it("404 sur le candidatId d'une autre organisation", async () => {
    await expect(contexteOrgB(() => candidatsService.findById(orgA.candidatId))).rejects.toThrow(
      NotFoundException
    );
  });

  it("404 sur un candidatId inexistant", async () => {
    await expect(contexteOrgA(() => candidatsService.findById(randomUUID()))).rejects.toThrow(NotFoundException);
  });

  it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
    const candidat = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
      candidatsService.findById(orgA.candidatId)
    );
    expect(candidat.id).toBe(orgA.candidatId);
  });
});
