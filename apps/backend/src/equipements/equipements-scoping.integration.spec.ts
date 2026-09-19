import { randomUUID } from "crypto";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, equipements, organisations, utilisateurs, type Database } from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuthModule } from "../auth/auth.module";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { EquipementsModule } from "./equipements.module";
import { EquipementsService } from "./equipements.service";

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  equipementId: string;
}

// Sous-commit 5c (chantier scoping multi-organisation, 2026-09-18) :
// EquipementsService.findById() ne vérifiait jusqu'ici jamais
// l'appartenance à l'organisation. equipements n'a pas de colonne
// organisationId directe (voir findAll()), le contrôle passe par une
// double jointure appartements -> bien. Aucun autre appelant interne
// (vérifié par grep — seul EquipementsController.findOne l'appelle).
//
// update()/archive() n'étaient pas protégées par ce sous-commit (Catégorie
// C, audit séparé) — corrigées en Priorité 3b (2026-09-19) via
// resoudreEquipementAvecAppartenance(), le même helper privé que
// findById() (aucun appelant interne, seul EquipementsController).
describe("EquipementsService — contrôle d'appartenance à l'organisation (findById/update/archive, intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let equipementsService: EquipementsService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Equipements Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `equipements-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `EquipementsScoping${suffixe}`,
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
    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: suffixe,
      type: "T3",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    const equipement = await equipementsService.create({ appartementId: appartement.id, type: "chaudiere" });

    return { organisationId: organisation.id, userId: user.id, equipementId: equipement.id };
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
        BienModule,
        AppartementsModule,
        EquipementsModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    equipementsService = moduleRef.get(EquipementsService);
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

  describe("findById", () => {
    it("réussit normalement quand l'équipement appartient à l'organisation appelante", async () => {
      const equipement = await contexteOrgA(() => equipementsService.findById(orgA.equipementId));
      expect(equipement.id).toBe(orgA.equipementId);
    });

    it("404 sur l'equipementId d'une autre organisation", async () => {
      await expect(contexteOrgB(() => equipementsService.findById(orgA.equipementId))).rejects.toThrow(
        NotFoundException
      );
    });

    it("404 sur un equipementId inexistant", async () => {
      await expect(contexteOrgA(() => equipementsService.findById(randomUUID()))).rejects.toThrow(
        NotFoundException
      );
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const equipement = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        equipementsService.findById(orgA.equipementId)
      );
      expect(equipement.id).toBe(orgA.equipementId);
    });
  });

  describe("update", () => {
    it("réussit normalement quand l'équipement appartient à l'organisation appelante", async () => {
      const misAJour = await contexteOrgA(() =>
        equipementsService.update(orgA.equipementId, { intervalleEntretienMois: 12 })
      );
      expect(misAJour.intervalleEntretienMois).toBe(12);
    });

    it("404 sur l'equipementId d'une autre organisation, sans jamais modifier la ligne étrangère", async () => {
      await expect(
        contexteOrgB(() => equipementsService.update(orgA.equipementId, { intervalleEntretienMois: 12 }))
      ).rejects.toThrow(NotFoundException);
      const [inchange] = await db.select().from(equipements).where(eq(equipements.id, orgA.equipementId));
      expect(inchange?.intervalleEntretienMois).toBeNull();
    });

    it("404 sur un equipementId inexistant", async () => {
      await expect(
        contexteOrgA(() => equipementsService.update(randomUUID(), { intervalleEntretienMois: 12 }))
      ).rejects.toThrow(NotFoundException);
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const misAJour = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        equipementsService.update(orgA.equipementId, { intervalleEntretienMois: 12 })
      );
      expect(misAJour.intervalleEntretienMois).toBe(12);
    });
  });

  describe("archive", () => {
    it("réussit normalement quand l'équipement appartient à l'organisation appelante", async () => {
      const archive = await contexteOrgA(() => equipementsService.archive(orgA.equipementId));
      expect(archive.archivedAt).not.toBeNull();
    });

    it("404 sur l'equipementId d'une autre organisation, sans jamais archiver la ligne étrangère", async () => {
      await expect(contexteOrgB(() => equipementsService.archive(orgA.equipementId))).rejects.toThrow(
        NotFoundException
      );
      const [inchange] = await db.select().from(equipements).where(eq(equipements.id, orgA.equipementId));
      expect(inchange?.archivedAt).toBeNull();
    });

    it("404 sur un equipementId inexistant", async () => {
      await expect(contexteOrgA(() => equipementsService.archive(randomUUID()))).rejects.toThrow(
        NotFoundException
      );
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const archive = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        equipementsService.archive(orgA.equipementId)
      );
      expect(archive.archivedAt).not.toBeNull();
    });
  });
});
