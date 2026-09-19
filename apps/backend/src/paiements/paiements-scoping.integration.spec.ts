import { randomUUID } from "crypto";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, paiements, utilisateurs, versements, type Database } from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuthModule } from "../auth/auth.module";
import { BauxModule } from "../baux/baux.module";
import { BauxService } from "../baux/baux.service";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { VersementsModule } from "../versements/versements.module";
import { VersementsService } from "../versements/versements.service";
import { PaiementsModule } from "./paiements.module";
import { PaiementsService } from "./paiements.service";

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  paiementId: string;
  versementId: string;
}

// Sous-commit 5c (chantier scoping multi-organisation, 2026-09-18) :
// PaiementsService.findById() ne vérifiait jusqu'ici jamais l'appartenance
// à l'organisation. paiements n'a pas de colonne organisationId directe
// (voir findAll()), le contrôle passe par une triple jointure baux ->
// appartements -> bien. Aucun autre appelant interne (vérifié par grep —
// seul PaiementsController.findOne l'appelle).
//
// update()/archive() n'étaient pas protégées par ce sous-commit (Catégorie
// C, audit séparé) — corrigées en Priorité 3b (2026-09-19) via
// resoudrePaiementAvecAppartenance(), le même helper privé que findById()
// (aucun appelant interne, seul PaiementsController). archive() cascade
// l'archivage des versements actifs du paiement dans la même transaction —
// le contrôle doit bloquer AVANT l'ouverture de cette transaction, pas
// seulement avant l'écriture sur `paiements` : la fixture inclut donc un
// versement réel par organisation pour en apporter la preuve.
describe("PaiementsService — contrôle d'appartenance à l'organisation (findById/update/archive, intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let paiementsService: PaiementsService;
  let versementsService: VersementsService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Paiements Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `paiements-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `PaiementsScoping${suffixe}`,
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
    const bail = await bauxService.create({ appartementId: appartement.id, typeBail: "vide", dateDebut: "2026-01-01" });
    const paiement = await paiementsService.create({
      bailId: bail.id,
      type: "loyer",
      montant: "800.00",
      dateEcheance: "2026-01-05"
    });
    const versement = await versementsService.ajouter({
      paiementId: paiement.id,
      montant: "800.00",
      mode: "virement",
      dateVersement: "2026-01-05"
    });

    return { organisationId: organisation.id, userId: user.id, paiementId: paiement.id, versementId: versement.id };
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
        BauxModule,
        PaiementsModule,
        VersementsModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    bauxService = moduleRef.get(BauxService);
    paiementsService = moduleRef.get(PaiementsService);
    versementsService = moduleRef.get(VersementsService);
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
    it("réussit normalement quand le paiement appartient à l'organisation appelante", async () => {
      const paiement = await contexteOrgA(() => paiementsService.findById(orgA.paiementId));
      expect(paiement.id).toBe(orgA.paiementId);
    });

    it("404 sur le paiementId d'une autre organisation", async () => {
      await expect(contexteOrgB(() => paiementsService.findById(orgA.paiementId))).rejects.toThrow(
        NotFoundException
      );
    });

    it("404 sur un paiementId inexistant", async () => {
      await expect(contexteOrgA(() => paiementsService.findById(randomUUID()))).rejects.toThrow(NotFoundException);
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const paiement = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        paiementsService.findById(orgA.paiementId)
      );
      expect(paiement.id).toBe(orgA.paiementId);
    });
  });

  describe("update", () => {
    it("réussit normalement quand le paiement appartient à l'organisation appelante", async () => {
      const misAJour = await contexteOrgA(() =>
        paiementsService.update(orgA.paiementId, { dateEcheance: "2026-02-05" })
      );
      expect(misAJour.dateEcheance).toBe("2026-02-05");
    });

    it("404 sur le paiementId d'une autre organisation, sans jamais modifier la ligne étrangère", async () => {
      await expect(
        contexteOrgB(() => paiementsService.update(orgA.paiementId, { dateEcheance: "2026-02-05" }))
      ).rejects.toThrow(NotFoundException);
      const [inchange] = await db.select().from(paiements).where(eq(paiements.id, orgA.paiementId));
      expect(inchange?.dateEcheance).toBe("2026-01-05");
    });

    it("404 sur un paiementId inexistant", async () => {
      await expect(
        contexteOrgA(() => paiementsService.update(randomUUID(), { dateEcheance: "2026-02-05" }))
      ).rejects.toThrow(NotFoundException);
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const misAJour = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        paiementsService.update(orgA.paiementId, { dateEcheance: "2026-02-05" })
      );
      expect(misAJour.dateEcheance).toBe("2026-02-05");
    });
  });

  describe("archive", () => {
    it("réussit normalement quand le paiement appartient à l'organisation appelante", async () => {
      const archive = await contexteOrgA(() => paiementsService.archive(orgA.paiementId));
      expect(archive.archivedAt).not.toBeNull();
    });

    it("404 sur le paiementId d'une autre organisation, sans jamais archiver la ligne ni sa cascade sur les versements actifs", async () => {
      await expect(contexteOrgB(() => paiementsService.archive(orgA.paiementId))).rejects.toThrow(
        NotFoundException
      );

      const [paiementInchange] = await db.select().from(paiements).where(eq(paiements.id, orgA.paiementId));
      expect(paiementInchange?.archivedAt).toBeNull();

      const [versementInchange] = await db.select().from(versements).where(eq(versements.id, orgA.versementId));
      expect(versementInchange?.archivedAt).toBeNull();
    });

    it("404 sur un paiementId inexistant", async () => {
      await expect(contexteOrgA(() => paiementsService.archive(randomUUID()))).rejects.toThrow(NotFoundException);
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const archive = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        paiementsService.archive(orgA.paiementId)
      );
      expect(archive.archivedAt).not.toBeNull();
    });
  });
});
