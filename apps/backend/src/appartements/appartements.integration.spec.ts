import { randomUUID } from "crypto";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, utilisateurs, type Database } from "db";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { AppartementsModule } from "./appartements.module";
import { AppartementsService } from "./appartements.service";

// Module Régularisation des charges, Sous-commit B (2026-10-01) : couverture
// du champ appartements.tantieme (pure saisie, aucun calcul de répartition
// à ce stade — voir docs/data-dictionary.md). Tourne contre un vrai
// Postgres, même fonctionnement que les autres suites d'intégration ; pas
// de requestContextService.run() ici, même choix que
// appartements-scoping.integration.spec.ts (organisationId absent du
// contexte, scoping applicatif non déclenché).
describe("AppartementsService — tantieme (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let userId: string;

  beforeEach(async () => {
    db = await begin();

    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), CommonModule, DatabaseModule, UsersModule, BienModule, AppartementsModule]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Appartements Tantieme Test" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `appartements-tantieme-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "AppartementsTantieme",
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

  async function creerBien() {
    return bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "personne_physique",
      nomProprietaire: "Jean Dupont",
      nom: "Immeuble Tantième Test",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
  }

  it("crée un appartement avec un tantieme décimal et le relit tel quel", async () => {
    const bien = await creerBien();

    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: "3B",
      type: "T3",
      tantieme: "125.50",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });

    expect(appartement.tantieme).toBe("125.50");

    const relu = await appartementsService.findById(appartement.id);
    expect(relu.tantieme).toBe("125.50");
  });

  it("tantieme reste null si non renseigné à la création", async () => {
    const bien = await creerBien();

    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: "4A",
      type: "T2",
      nombrePiecesPrincipales: 2,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });

    expect(appartement.tantieme).toBeNull();
  });

  it("met à jour tantieme sur un appartement existant, sans toucher aux autres champs", async () => {
    const bien = await creerBien();
    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: "5C",
      type: "T1",
      surface: "28.00",
      nombrePiecesPrincipales: 1,
      modeChauffage: "collectif",
      modeEauChaude: "collectif"
    });
    expect(appartement.tantieme).toBeNull();

    const misAJour = await appartementsService.update(appartement.id, { tantieme: "42.00" });

    expect(misAJour.tantieme).toBe("42.00");
    expect(misAJour.surface).toBe("28.00");
    expect(misAJour.numero).toBe("5C");
  });
});
