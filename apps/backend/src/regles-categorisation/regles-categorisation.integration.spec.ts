import { randomUUID } from "crypto";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, utilisateurs, type Database } from "db";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { CommonModule } from "../common/common.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { ReglesCategorisationModule } from "./regles-categorisation.module";
import { ReglesCategorisationService } from "./regles-categorisation.service";

// Module Charges et fiscalité, Étape 2 (docs/backlog.md) : création,
// consultation (scopée par organisation) et archivage (jamais de
// suppression physique) d'une règle de catégorisation. Tourne contre un
// vrai Postgres — voir scis.integration.spec.ts pour le fonctionnement
// général. Chaque test tourne dans sa propre transaction annulée dans
// afterEach (voir test-utils/transactional-test.ts), setup (organisation +
// utilisateur) compris.
describe("ReglesCategorisationService (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let reglesCategorisationService: ReglesCategorisationService;
  let db: Database;
  let userId: string;
  let organisationId: string;

  beforeEach(async () => {
    db = await begin();

    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), CommonModule, DatabaseModule, UsersModule, ReglesCategorisationModule]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    reglesCategorisationService = moduleRef.get(ReglesCategorisationService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Règles Catégorisation Intégration" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }

    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `regles-categorisation-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Règles",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    userId = user.id;
    organisationId = organisation.id;
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  it("crée une règle rattachée à l'organisation de l'utilisateur authentifié", async () => {
    const regle = await reglesCategorisationService.create(userId, { motCle: "edf", categorie: "charges_copropriete" });
    expect(regle.motCle).toBe("edf");
    expect(regle.categorie).toBe("charges_copropriete");
    expect(regle.organisationId).toBe(organisationId);
  });

  it("findAllActives filtre par organisation et exclut les règles archivées", async () => {
    const regle1 = await reglesCategorisationService.create(userId, { motCle: "edf", categorie: "charges_copropriete" });
    await reglesCategorisationService.create(userId, { motCle: "maif", categorie: "assurance" });
    await reglesCategorisationService.archive(regle1.id);

    const actives = await reglesCategorisationService.findAllActives(organisationId);
    expect(actives.map((r) => r.motCle)).toEqual(["maif"]);
  });

  it("findAllActives d'une autre organisation ne renvoie rien", async () => {
    await reglesCategorisationService.create(userId, { motCle: "edf", categorie: "charges_copropriete" });
    const autresRegles = await reglesCategorisationService.findAllActives(randomUUID());
    expect(autresRegles).toHaveLength(0);
  });

  it("archive() retire une règle de findAllActives mais ne la supprime pas physiquement", async () => {
    const regle = await reglesCategorisationService.create(userId, { motCle: "edf", categorie: "charges_copropriete" });
    const archivee = await reglesCategorisationService.archive(regle.id);
    expect(archivee.id).toBe(regle.id);

    const actives = await reglesCategorisationService.findAllActives(organisationId);
    expect(actives).toHaveLength(0);
  });
});
