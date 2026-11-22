import { randomUUID } from "crypto";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  appartements,
  baux,
  bien,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  organisations,
  scis,
  utilisateurs,
  type Database
} from "db";
import { count, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { BauxModule } from "../baux/baux.module";
import { BauxService } from "../baux/baux.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { BienModule } from "./bien.module";
import { BienService } from "./bien.service";

// Commit 4 des petites suites, décision 5 : un bien ne s'archive pas s'il a
// un bail actif ou en préavis, ou s'il lui reste des appartements non
// archivés ; une SCI ne s'archive pas s'il lui reste un bail actif ou en
// préavis (par ses biens), ou des biens non archivés. Ordre : 404
// d'appartenance → 409 « Déjà archivé » → ces refus → écriture. Cas
// séquentiels ; les courses sont vérifiées en vrai parallèle dans
// bien-sci-archivage-concurrence.integration.spec.ts.

describe("Archivage d'un bien ou d'une SCI : refusé tant qu'il reste des fiches actives (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let requestContextService: RequestContextService;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let orgA: { organisationId: string; userId: string };
  let orgB: { organisationId: string; userId: string };

  function enA<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte({ utilisateurId: orgA.userId, organisationId: orgA.organisationId }, fn);
  }

  function enB<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte({ utilisateurId: orgB.userId, organisationId: orgB.organisationId }, fn);
  }

  async function creerOrganisation(suffixe: string) {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Archivage bien/SCI ${suffixe}` })
      .returning();
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation!.id,
        email: `archivage-bien-sci-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `ArchivageBienSci${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    return { organisationId: organisation!.id, userId: user!.id };
  }

  function creerSci(): Promise<string> {
    return enA(async () =>
      (
        await scisService.create(orgA.userId, {
          nom: `SCI ${randomUUID().slice(0, 6)}`,
          regimeFiscal: "IR",
          adresse: "1 rue de Test",
          codePostal: "75001",
          ville: "Paris"
        })
      ).id
    );
  }

  function creerBien(sciId?: string): Promise<string> {
    return enA(async () =>
      (
        await bienService.create(orgA.userId, {
          type: "maison",
          ...(sciId
            ? { proprietaireType: "sci" as const, sciId }
            : { proprietaireType: "personne_physique" as const, nomProprietaire: "Propriétaire" }),
          adresse: "2 rue de Test",
          codePostal: "75002",
          ville: "Paris"
        })
      ).id
    );
  }

  function creerAppartement(bienId: string): Promise<string> {
    return enA(async () =>
      (
        await appartementsService.create({
          bienId,
          numero: `A-${randomUUID().slice(0, 6)}`,
          type: "T2",
          nombrePiecesPrincipales: 2,
          modeChauffage: "individuel",
          modeEauChaude: "individuel",
          loyerReference: "700.00"
        })
      ).id
    );
  }

  async function creerBailActif(appartementId: string): Promise<string> {
    return enA(async () => {
      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-01-01",
        loyerMensuel: "700.00",
        jourEcheance: 5
      });
      await bauxService.activer(bail.id);
      return bail.id;
    });
  }

  async function ligneBien(id: string) {
    const [ligne] = await db.select().from(bien).where(eq(bien.id, id));
    return ligne;
  }

  async function ligneSci(id: string) {
    const [ligne] = await db.select().from(scis).where(eq(scis.id, id));
    return ligne;
  }

  beforeEach(async () => {
    db = await begin();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        CommonModule,
        DatabaseModule,
        EncryptionModule,
        AuditModule,
        UsersModule,
        AuthModule,
        ScisModule,
        BienModule,
        AppartementsModule,
        BauxModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();
    requestContextService = moduleRef.get(RequestContextService);
    scisService = moduleRef.get(ScisService);
    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    bauxService = moduleRef.get(BauxService);
    orgA = await creerOrganisation("A");
    orgB = await creerOrganisation("B");
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  describe("bien", () => {
    it("un appartement non archivé → 409 « Archivez d'abord l'appartement de ce bien. », bien inchangé", async () => {
      const bienId = await creerBien();
      await creerAppartement(bienId);
      const avant = await ligneBien(bienId);

      const appel = enA(() => bienService.archive(bienId));
      await expect(appel).rejects.toThrow(ConflictException);
      await expect(appel).rejects.toThrow("Archivez d'abord l'appartement de ce bien.");
      expect(await ligneBien(bienId)).toEqual(avant);
    });

    it("trois appartements non archivés (un quatrième archivé) → message avec le nombre", async () => {
      const bienId = await creerBien();
      for (let i = 0; i < 3; i++) {
        await creerAppartement(bienId);
      }
      const archive = await creerAppartement(bienId);
      await enA(() => appartementsService.archive(archive));

      await expect(enA(() => bienService.archive(bienId))).rejects.toThrow(
        "Archivez d'abord les 3 appartements de ce bien."
      );
    });

    it("un bail actif → 409 qui dit de résilier d'abord, bien inchangé", async () => {
      const bienId = await creerBien();
      await creerBailActif(await creerAppartement(bienId));
      const avant = await ligneBien(bienId);

      await expect(enA(() => bienService.archive(bienId))).rejects.toThrow(
        "Ce bien a un bail actif ou en préavis. Résiliez-le d'abord, archivez ses appartements, puis archivez le bien."
      );
      expect(await ligneBien(bienId)).toEqual(avant);
    });

    it("tous les appartements archivés → archivage accepté", async () => {
      const bienId = await creerBien();
      const appartementId = await creerAppartement(bienId);
      await enA(() => appartementsService.archive(appartementId));

      const archive = await enA(() => bienService.archive(bienId));
      expect(archive.archivedAt).not.toBeNull();
    });

    it("bien d'une autre organisation avec appartements → 404, pas 409", async () => {
      const bienId = await creerBien();
      await creerAppartement(bienId);
      await expect(enB(() => bienService.archive(bienId))).rejects.toThrow(NotFoundException);
    });
  });

  describe("SCI", () => {
    it("un bien non archivé → 409 « Archivez d'abord le bien de cette SCI. », SCI inchangée", async () => {
      const sciId = await creerSci();
      await creerBien(sciId);
      const avant = await ligneSci(sciId);

      const appel = enA(() => scisService.archive(sciId));
      await expect(appel).rejects.toThrow(ConflictException);
      await expect(appel).rejects.toThrow("Archivez d'abord le bien de cette SCI.");
      expect(await ligneSci(sciId)).toEqual(avant);
    });

    it("deux biens non archivés (un troisième archivé) → message avec le nombre", async () => {
      const sciId = await creerSci();
      await creerBien(sciId);
      await creerBien(sciId);
      const archive = await creerBien(sciId);
      await enA(() => bienService.archive(archive));

      await expect(enA(() => scisService.archive(sciId))).rejects.toThrow("Archivez d'abord les 2 biens de cette SCI.");
    });

    it("deux baux actifs sur ses biens → 409 qui dit de résilier d'abord", async () => {
      const sciId = await creerSci();
      const bienId = await creerBien(sciId);
      await creerBailActif(await creerAppartement(bienId));
      await creerBailActif(await creerAppartement(bienId));

      await expect(enA(() => scisService.archive(sciId))).rejects.toThrow(
        "Cette SCI a 2 baux actifs ou en préavis sur ses biens. Résiliez-les d'abord, archivez les appartements et les biens, puis archivez la SCI."
      );
    });

    it("tous les biens archivés → archivage accepté", async () => {
      const sciId = await creerSci();
      const bienId = await creerBien(sciId);
      await enA(() => bienService.archive(bienId));

      const archive = await enA(() => scisService.archive(sciId));
      expect(archive.archivedAt).not.toBeNull();
    });

    it("SCI d'une autre organisation avec biens → 404, pas 409", async () => {
      const sciId = await creerSci();
      await creerBien(sciId);
      await expect(enB(() => scisService.archive(sciId))).rejects.toThrow(NotFoundException);
    });
  });

  // Compléments du 2026-11-22 (commit 4) : aucune création dans un parent
  // archivé (409 après le 404 d'appartenance). Le désarchivage viendra au
  // commit 10.
  describe("créations dans un parent archivé", () => {
    async function nombre(table: typeof appartements | typeof bien | typeof baux): Promise<number> {
      const [ligne] = await db.select({ n: count() }).from(table);
      return ligne?.n ?? 0;
    }

    it("appartement dans un bien archivé → 409, aucun appartement créé", async () => {
      const bienId = await creerBien();
      await enA(() => bienService.archive(bienId));
      const avant = await nombre(appartements);

      const appel = creerAppartement(bienId);
      await expect(appel).rejects.toThrow(ConflictException);
      await expect(appel).rejects.toThrow(
        "Ce bien est archivé : aucun appartement ne peut y être ajouté tant qu'il n'est pas désarchivé."
      );
      expect(await nombre(appartements)).toBe(avant);
    });

    it("appartement dans un bien archivé d'une autre organisation → 404, pas 409", async () => {
      const bienId = await creerBien();
      await enA(() => bienService.archive(bienId));
      await expect(
        enB(() =>
          appartementsService.create({
            bienId,
            numero: "X",
            type: "T2",
            nombrePiecesPrincipales: 2,
            modeChauffage: "individuel",
            modeEauChaude: "individuel"
          })
        )
      ).rejects.toThrow(NotFoundException);
    });

    it("bien dans une SCI archivée → 409, aucun bien créé", async () => {
      const sciId = await creerSci();
      await enA(() => scisService.archive(sciId));
      const avant = await nombre(bien);

      const appel = creerBien(sciId);
      await expect(appel).rejects.toThrow(ConflictException);
      await expect(appel).rejects.toThrow(
        "Cette SCI est archivée : aucun bien ne peut y être rattaché tant qu'elle n'est pas désarchivée."
      );
      expect(await nombre(bien)).toBe(avant);
    });

    it("bien dans une SCI archivée d'une autre organisation → 404, pas 409", async () => {
      const sciId = await creerSci();
      await enA(() => scisService.archive(sciId));
      await expect(
        enB(() =>
          bienService.create(orgB.userId, {
            type: "maison",
            proprietaireType: "sci",
            sciId,
            adresse: "2 rue de Test",
            codePostal: "75002",
            ville: "Paris"
          })
        )
      ).rejects.toThrow(NotFoundException);
    });

    it("bail (brouillon) sur un appartement archivé → 409, aucun bail créé", async () => {
      const appartementId = await creerAppartement(await creerBien());
      await enA(() => appartementsService.archive(appartementId));
      const avant = await nombre(baux);

      const appel = enA(() =>
        bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-01-01", loyerMensuel: "700.00" })
      );
      await expect(appel).rejects.toThrow(ConflictException);
      await expect(appel).rejects.toThrow(
        "Cet appartement est archivé : aucun bail ne peut y être créé tant qu'il n'est pas désarchivé."
      );
      expect(await nombre(baux)).toBe(avant);
    });

    it("bail sur un appartement archivé d'une autre organisation → 404, pas 409", async () => {
      const appartementId = await creerAppartement(await creerBien());
      await enA(() => appartementsService.archive(appartementId));
      await expect(
        enB(() => bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-01-01", loyerMensuel: "700.00" }))
      ).rejects.toThrow(NotFoundException);
    });

    it("parents non archivés : créations acceptées (non-régression)", async () => {
      const sciId = await creerSci();
      const bienId = await creerBien(sciId);
      const appartementId = await creerAppartement(bienId);
      const bail = await enA(() =>
        bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-01-01", loyerMensuel: "700.00" })
      );
      expect(bail.appartementId).toBe(appartementId);
    });
  });
});
