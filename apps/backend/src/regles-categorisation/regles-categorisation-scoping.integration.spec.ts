import { randomUUID } from "crypto";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, regleCategorisation, utilisateurs, type Database } from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { ReglesCategorisationModule } from "./regles-categorisation.module";
import { ReglesCategorisationService } from "./regles-categorisation.service";

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  regleId: string;
}

// Priorité 3a (chantier scoping multi-organisation, Catégorie C, 2026-09-19) :
// archive() refaisait sa propre écriture via mettreAJourAvecAudit sans
// jamais vérifier l'organisation — ce service n'a jamais eu de findById()
// (aucun endpoint de lecture à l'unité), donc pas de helper préexistant à
// réutiliser contrairement aux autres services de cette priorité : extrait
// directement dans archive() (resoudreRegleAvecAppartenance(), privée),
// même principe que Catégorie A (colonne organisationId directe).
describe("ReglesCategorisationService.archive — contrôle d'appartenance à l'organisation (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let reglesCategorisationService: ReglesCategorisationService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Règles Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `regles-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `ReglesScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }

    const regle = await reglesCategorisationService.create(user.id, {
      motCle: `edf-${suffixe}`,
      categorie: "charges_copropriete"
    });

    return { organisationId: organisation.id, userId: user.id, regleId: regle.id };
  }

  beforeEach(async () => {
    db = await begin();

    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), CommonModule, DatabaseModule, UsersModule, ReglesCategorisationModule]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    reglesCategorisationService = moduleRef.get(ReglesCategorisationService);
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

  it("réussit normalement quand la règle appartient à l'organisation appelante", async () => {
    const archive = await contexteOrgA(() => reglesCategorisationService.archive(orgA.regleId));
    expect(archive.id).toBe(orgA.regleId);
  });

  it("404 sur le regleId d'une autre organisation, sans jamais archiver la ligne étrangère", async () => {
    await expect(contexteOrgB(() => reglesCategorisationService.archive(orgA.regleId))).rejects.toThrow(
      NotFoundException
    );
    const [inchangee] = await db.select().from(regleCategorisation).where(eq(regleCategorisation.id, orgA.regleId));
    expect(inchangee?.archivedAt).toBeNull();
  });

  it("404 sur un regleId inexistant", async () => {
    await expect(contexteOrgA(() => reglesCategorisationService.archive(randomUUID()))).rejects.toThrow(
      NotFoundException
    );
  });

  it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
    const archive = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
      reglesCategorisationService.archive(orgA.regleId)
    );
    expect(archive.id).toBe(orgA.regleId);
  });
});
