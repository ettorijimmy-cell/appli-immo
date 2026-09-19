import { randomUUID } from "crypto";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { appartements, createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, utilisateurs, type Database } from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthModule } from "../auth/auth.module";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { AppartementsModule } from "./appartements.module";
import { AppartementsService } from "./appartements.service";

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  appartementId: string;
}

// Sous-commit 5c (chantier scoping multi-organisation, 2026-09-18) :
// AppartementsService.findById() ne vérifiait jusqu'ici jamais
// l'appartenance à l'organisation. appartements n'a pas de colonne
// organisationId directe (voir findAll()), le contrôle passe par une
// jointure vers bien. Aucun autre appelant interne (vérifié par grep —
// seul AppartementsController.findOne l'appelle).
//
// update()/archive() n'étaient pas protégées par ce sous-commit (Catégorie
// C, audit séparé) — corrigées en Priorité 3b (2026-09-19) via
// resoudreAppartementAvecAppartenance(), le même helper privé que
// findById() (aucun appelant interne, seul AppartementsController).
describe("AppartementsService — contrôle d'appartenance à l'organisation (findById/update/archive, intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Appartements Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `appartements-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `AppartementsScoping${suffixe}`,
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

    return { organisationId: organisation.id, userId: user.id, appartementId: appartement.id };
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
        AppartementsModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
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
    it("réussit normalement quand l'appartement appartient à l'organisation appelante", async () => {
      const appartement = await contexteOrgA(() => appartementsService.findById(orgA.appartementId));
      expect(appartement.id).toBe(orgA.appartementId);
    });

    it("404 sur l'appartementId d'une autre organisation", async () => {
      await expect(contexteOrgB(() => appartementsService.findById(orgA.appartementId))).rejects.toThrow(
        NotFoundException
      );
    });

    it("404 sur un appartementId inexistant", async () => {
      await expect(contexteOrgA(() => appartementsService.findById(randomUUID()))).rejects.toThrow(
        NotFoundException
      );
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const appartement = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        appartementsService.findById(orgA.appartementId)
      );
      expect(appartement.id).toBe(orgA.appartementId);
    });
  });

  describe("update", () => {
    it("réussit normalement quand l'appartement appartient à l'organisation appelante", async () => {
      const misAJour = await contexteOrgA(() => appartementsService.update(orgA.appartementId, { numero: "42" }));
      expect(misAJour.numero).toBe("42");
    });

    it("404 sur l'appartementId d'une autre organisation, sans jamais modifier la ligne étrangère", async () => {
      await expect(
        contexteOrgB(() => appartementsService.update(orgA.appartementId, { numero: "42" }))
      ).rejects.toThrow(NotFoundException);
      const [inchange] = await db.select().from(appartements).where(eq(appartements.id, orgA.appartementId));
      expect(inchange?.numero).toBe("A");
    });

    it("404 sur un appartementId inexistant", async () => {
      await expect(
        contexteOrgA(() => appartementsService.update(randomUUID(), { numero: "42" }))
      ).rejects.toThrow(NotFoundException);
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const misAJour = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        appartementsService.update(orgA.appartementId, { numero: "42" })
      );
      expect(misAJour.numero).toBe("42");
    });
  });

  describe("archive", () => {
    it("réussit normalement quand l'appartement appartient à l'organisation appelante", async () => {
      const archive = await contexteOrgA(() => appartementsService.archive(orgA.appartementId));
      expect(archive.archivedAt).not.toBeNull();
    });

    it("404 sur l'appartementId d'une autre organisation, sans jamais archiver la ligne étrangère", async () => {
      await expect(contexteOrgB(() => appartementsService.archive(orgA.appartementId))).rejects.toThrow(
        NotFoundException
      );
      const [inchange] = await db.select().from(appartements).where(eq(appartements.id, orgA.appartementId));
      expect(inchange?.archivedAt).toBeNull();
      expect(inchange?.statut).not.toBe("archive");
    });

    it("404 sur un appartementId inexistant", async () => {
      await expect(contexteOrgA(() => appartementsService.archive(randomUUID()))).rejects.toThrow(
        NotFoundException
      );
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const archive = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        appartementsService.archive(orgA.appartementId)
      );
      expect(archive.archivedAt).not.toBeNull();
    });
  });
});
