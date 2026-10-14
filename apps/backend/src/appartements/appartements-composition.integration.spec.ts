import { randomUUID } from "crypto";
import { BadRequestException } from "@nestjs/common";
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

// Point 6c (docs/backlog.md) : equipementCuisine/dependancesAnnexes
// (exigés par validerCompletudeGenerationBail) et les 5 champs de
// composition du logement manquaient jusqu'ici à la création. Tourne
// contre un vrai Postgres, même fonctionnement que
// appartements.integration.spec.ts (tantieme) — pas de
// requestContextService.run() ici, scoping applicatif non déclenché.
describe("AppartementsService — composition du lot (intégration Postgres réelle)", () => {
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
      .values({ type: "particulier", nom: "Organisation Appartements Composition Test" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `appartements-composition-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "AppartementsComposition",
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

  async function creerBienResidentiel() {
    return bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "personne_physique",
      nomProprietaire: "Jean Dupont",
      nom: "Immeuble Composition Test",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
  }

  async function creerBienNonResidentiel() {
    return bienService.create(userId, {
      type: "parking",
      proprietaireType: "personne_physique",
      nomProprietaire: "Jean Dupont",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
  }

  it("écrit les 7 champs de composition dès la création (même bug que 4faa41d évité)", async () => {
    const bien = await creerBienResidentiel();

    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: "3B",
      type: "T3",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel",
      equipementCuisine: "Plaques + four",
      dependancesAnnexes: "Cave",
      nombreChambres: 2,
      nombreSallesDeBain: 1,
      nombreWc: 1,
      autrePiece1: "Bureau",
      autrePiece2: "Dressing"
    });

    expect(appartement.equipementCuisine).toBe("Plaques + four");
    expect(appartement.dependancesAnnexes).toBe("Cave");
    expect(appartement.nombreChambres).toBe(2);
    expect(appartement.nombreSallesDeBain).toBe(1);
    expect(appartement.nombreWc).toBe(1);
    expect(appartement.autrePiece1).toBe("Bureau");
    expect(appartement.autrePiece2).toBe("Dressing");

    const relu = await appartementsService.findById(appartement.id);
    expect(relu.equipementCuisine).toBe("Plaques + four");
    expect(relu.dependancesAnnexes).toBe("Cave");
  });

  it("remet un champ à null pour l'effacer réellement, jamais en omettant la clé", async () => {
    const bien = await creerBienResidentiel();
    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: "4A",
      type: "T2",
      nombrePiecesPrincipales: 2,
      modeChauffage: "individuel",
      modeEauChaude: "individuel",
      equipementCuisine: "Plaques + four"
    });
    expect(appartement.equipementCuisine).toBe("Plaques + four");

    const misAJour = await appartementsService.update(appartement.id, { equipementCuisine: null });

    expect(misAJour.equipementCuisine).toBeNull();
  });

  it("refuse de mettre nombrePiecesPrincipales à null pour un bien résidentiel", async () => {
    const bien = await creerBienResidentiel();
    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: "5C",
      type: "T1",
      nombrePiecesPrincipales: 1,
      modeChauffage: "collectif",
      modeEauChaude: "collectif"
    });

    await expect(appartementsService.update(appartement.id, { nombrePiecesPrincipales: null })).rejects.toThrow(
      BadRequestException
    );

    const relu = await appartementsService.findById(appartement.id);
    expect(relu.nombrePiecesPrincipales).toBe(1);
  });

  it("refuse de mettre modeChauffage/modeEauChaude/type à null pour un bien résidentiel", async () => {
    const bien = await creerBienResidentiel();
    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: "6D",
      type: "T2",
      nombrePiecesPrincipales: 2,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });

    await expect(appartementsService.update(appartement.id, { modeChauffage: null })).rejects.toThrow(
      BadRequestException
    );
    await expect(appartementsService.update(appartement.id, { modeEauChaude: null })).rejects.toThrow(
      BadRequestException
    );
    await expect(appartementsService.update(appartement.id, { type: null })).rejects.toThrow(BadRequestException);
  });

  it("une valeur `null` explicite sur depensesEnergieMin n'est pas comparée à l'ancienne valeur en base", async () => {
    const bien = await creerBienResidentiel();
    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: "7E",
      type: "T2",
      nombrePiecesPrincipales: 2,
      modeChauffage: "individuel",
      modeEauChaude: "individuel",
      depensesEnergieMin: "100.00",
      depensesEnergieMax: "150.00"
    });

    // Avant le fix de la comparaison min/max (`??` -> `=== undefined`),
    // `depensesEnergieMin: null` retombait sur l'ancien min (100.00) pour
    // la vérification croisée min <= max, au lieu d'être traité comme
    // "aucun min à comparer". Nouveau max (50.00) < ancien min (100.00) :
    // sans le fix, la comparaison 100 > 50 aurait levé une erreur à tort
    // alors que min est justement en train d'être effacé.
    const misAJour = await appartementsService.update(appartement.id, {
      depensesEnergieMin: null,
      depensesEnergieMax: "50.00"
    });

    expect(misAJour.depensesEnergieMin).toBeNull();
    expect(misAJour.depensesEnergieMax).toBe("50.00");
  });

  it("un appartement non résidentiel n'est pas affecté par le garde-fou résidentiel (type/pieces/chauffage non fournis)", async () => {
    const bienNonResidentiel = await creerBienNonResidentiel();
    const appartement = await appartementsService.create({
      bienId: bienNonResidentiel.id,
      numero: "P1",
      equipementCuisine: "Sans objet"
    });

    const misAJour = await appartementsService.update(appartement.id, { equipementCuisine: null });
    expect(misAJour.equipementCuisine).toBeNull();
  });
});
