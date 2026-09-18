import { randomUUID } from "crypto";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, immeublesLegacy, organisations, utilisateurs, type Database } from "db";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthModule } from "../auth/auth.module";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { ImmeublesModule } from "./immeubles.module";
import { ImmeublesService } from "./immeubles.service";

interface FixtureOrganisation {
  organisationId: string;
  immeubleId: string;
}

// Sous-commit 5b (chantier scoping multi-organisation, 2026-09-18) :
// ImmeublesService.findById() ne vérifiait jusqu'ici jamais l'appartenance
// à l'organisation. immeubles_legacy n'a qu'une FK vers scis, deux sauts
// jusqu'à organisation_sci (même chemin que findAll()). Table gelée en
// écriture depuis le 2026-08-27 (create/update/archive retirés), mais ce
// gel ne porte que sur l'écriture — la lecture et son scoping restent
// nécessaires (DocumentsService continue de résoudre les documents
// historiques rattachés à ces lignes). Aucun autre appelant interne
// (vérifié par grep — seul ImmeublesController.findOne l'appelle ;
// DocumentsService résout immeubles_legacy/organisation_sci par ses
// propres requêtes, sans jamais appeler ImmeublesService.findById()).
// Aucune méthode create() n'existe (table gelée) — insertion directe en
// base pour la fixture, comme pour taches-scoping/messages-communication
// -scoping (Sous-commit 5a).
describe("ImmeublesService.findById — contrôle d'appartenance à l'organisation (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let scisService: ScisService;
  let immeublesService: ImmeublesService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Immeubles Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `immeubles-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `ImmeublesScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }

    const sci = await scisService.create(user.id, {
      nom: `SCI Immeubles Scoping ${suffixe}`,
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });

    const [immeuble] = await db
      .insert(immeublesLegacy)
      .values({ sciId: sci.id, nom: `Immeuble Legacy Scoping ${suffixe}`, adresse: "1 rue de Test" })
      .returning();
    if (!immeuble) {
      throw new Error("Échec de l'insertion de l'immeuble legacy de test");
    }

    return { organisationId: organisation.id, immeubleId: immeuble.id };
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
        ScisModule,
        ImmeublesModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    immeublesService = moduleRef.get(ImmeublesService);
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
    return requestContextService.executerAvecContexte({ utilisateurId: null, organisationId: orgA.organisationId }, fn);
  }
  function contexteOrgB<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte({ utilisateurId: null, organisationId: orgB.organisationId }, fn);
  }

  it("réussit normalement quand l'immeuble appartient à l'organisation appelante", async () => {
    const immeuble = await contexteOrgA(() => immeublesService.findById(orgA.immeubleId));
    expect(immeuble.id).toBe(orgA.immeubleId);
  });

  it("404 sur l'immeubleId d'une autre organisation", async () => {
    await expect(contexteOrgB(() => immeublesService.findById(orgA.immeubleId))).rejects.toThrow(
      NotFoundException
    );
  });

  it("404 sur un immeubleId inexistant", async () => {
    await expect(contexteOrgA(() => immeublesService.findById(randomUUID()))).rejects.toThrow(NotFoundException);
  });

  it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
    const immeuble = await requestContextService.executerAvecContexte({ utilisateurId: null }, () =>
      immeublesService.findById(orgA.immeubleId)
    );
    expect(immeuble.id).toBe(orgA.immeubleId);
  });
});
