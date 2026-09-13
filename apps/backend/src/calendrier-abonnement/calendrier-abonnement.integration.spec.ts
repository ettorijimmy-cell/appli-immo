import { randomUUID } from "crypto";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, utilisateurs, type Database } from "db";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { CommonModule } from "../common/common.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { CalendrierAbonnementModule } from "./calendrier-abonnement.module";
import { CalendrierAbonnementService } from "./calendrier-abonnement.service";

// Module Calendrier d'interventions (2026-09-15) : jeton d'abonnement ICS,
// long et aléatoire, révocable — le flux GET /calendrier/ics/:jeton
// (CalendrierIcsController, @Public()) s'appuie entièrement sur
// trouverOrganisationParJeton pour distinguer un jeton valide d'un jeton
// inexistant, sans jamais lever d'exception distincte entre les deux cas
// (voir CalendrierIcsController — 404 générique). Chaque test tourne dans
// sa propre transaction annulée dans afterEach (test-utils/transactional-test.ts).
describe("CalendrierAbonnementService (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let calendrierAbonnementService: CalendrierAbonnementService;
  let db: Database;
  let userId: string;
  let organisationId: string;

  beforeEach(async () => {
    db = await begin();

    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), CommonModule, DatabaseModule, UsersModule, CalendrierAbonnementModule]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    calendrierAbonnementService = moduleRef.get(CalendrierAbonnementService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Abonnement Intégration" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    organisationId = organisation.id;

    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `abonnement-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Abonnement",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    userId = user.id;
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  it("génère un jeton long et aléatoire pour une organisation qui n'en a pas encore", async () => {
    const abonnement = await calendrierAbonnementService.genererOuRegenererJeton(userId);
    expect(abonnement.jeton).toHaveLength(64); // randomBytes(32).toString("hex")
    expect(abonnement.organisationId).toBe(organisationId);
  });

  it("régénérer remplace le jeton existant (une seule ligne par organisation)", async () => {
    const premier = await calendrierAbonnementService.genererOuRegenererJeton(userId);
    const second = await calendrierAbonnementService.genererOuRegenererJeton(userId);

    expect(second.jeton).not.toBe(premier.jeton);
    expect(second.id).toBe(premier.id);

    const parOrganisation = await calendrierAbonnementService.trouverParOrganisation(organisationId);
    expect(parOrganisation?.jeton).toBe(second.jeton);
  });

  it("l'ancien jeton révoqué ne résout plus vers l'organisation", async () => {
    const premier = await calendrierAbonnementService.genererOuRegenererJeton(userId);
    await calendrierAbonnementService.genererOuRegenererJeton(userId);

    const resultat = await calendrierAbonnementService.trouverOrganisationParJeton(premier.jeton);
    expect(resultat).toBeNull();
  });

  it("trouverOrganisationParJeton résout un jeton valide vers son organisation", async () => {
    const abonnement = await calendrierAbonnementService.genererOuRegenererJeton(userId);
    const resultat = await calendrierAbonnementService.trouverOrganisationParJeton(abonnement.jeton);
    expect(resultat).toBe(organisationId);
  });

  it("trouverOrganisationParJeton renvoie null pour un jeton inexistant, sans distinction avec un jeton mal formé", async () => {
    const resultatInexistant = await calendrierAbonnementService.trouverOrganisationParJeton(randomUUID());
    const resultatMalForme = await calendrierAbonnementService.trouverOrganisationParJeton("pas-un-jeton-valide");
    expect(resultatInexistant).toBeNull();
    expect(resultatMalForme).toBeNull();
  });

  it("obtenirPourUtilisateur renvoie null tant qu'aucun jeton n'a été généré", async () => {
    const resultat = await calendrierAbonnementService.obtenirPourUtilisateur(userId);
    expect(resultat).toBeNull();
  });
});
