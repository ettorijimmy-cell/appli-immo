import { randomUUID } from "crypto";
import { rm } from "fs/promises";
import os from "os";
import path from "path";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  baux,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  organisations,
  paiements,
  remboursements,
  utilisateurs,
  versements,
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
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { RemboursementsModule } from "../remboursements/remboursements.module";
import { RemboursementsService } from "../remboursements/remboursements.service";
import { StorageModule } from "../storage/storage.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { VersementsModule } from "../versements/versements.module";
import { VersementsService } from "../versements/versements.service";
import { PaiementsModule } from "./paiements.module";
import { PaiementsService } from "./paiements.service";

// Commit 3b des petites suites : aucune écriture financière sur une
// échéance archivée (compléments du 2026-11-22 soir). Cas séquentiels, sur
// la connexion unique des tests ; les courses (verrou du bail, statut du
// bail dans l'UPDATE) sont vérifiées en vrai parallèle dans
// echeances-verrou-bail-concurrence.integration.spec.ts.

const MESSAGE_VERSEMENT_ECHEANCE_ARCHIVEE = "Cette échéance est archivée : aucun versement ne peut y être ajouté.";
const MESSAGE_REMBOURSEMENT_ECHEANCE_ARCHIVEE =
  "Cette échéance est archivée : aucun remboursement ne peut y être rattaché.";

describe("Échéances archivées : aucune écriture financière (intégration Postgres réelle)", () => {
  const storageDirTest = path.join(os.tmpdir(), `appli-immo-test-echeances-archivees-${randomUUID()}`);
  process.env["DOCUMENTS_STORAGE_DIR"] = storageDirTest;

  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let requestContextService: RequestContextService;
  let bauxService: BauxService;
  let paiementsService: PaiementsService;
  let versementsService: VersementsService;
  let remboursementsService: RemboursementsService;
  let orgA: { organisationId: string; userId: string; bienId: string };
  let orgB: { organisationId: string; userId: string };

  function enA<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte(
      { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
      fn
    );
  }

  function enB<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte(
      { utilisateurId: orgB.userId, organisationId: orgB.organisationId },
      fn
    );
  }

  async function creerOrganisation(suffixe: string) {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Échéances archivées ${suffixe}` })
      .returning();
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation!.id,
        email: `echeances-archivees-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `EcheancesArchivees${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    return { organisationId: organisation!.id, userId: user!.id };
  }

  async function creerBailBrouillon(): Promise<string> {
    const appartement = await moduleRef.get(AppartementsService).create({
      bienId: orgA.bienId,
      numero: `B-${randomUUID().slice(0, 6)}`,
      type: "T2",
      nombrePiecesPrincipales: 2,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    const bail = await bauxService.create({
      appartementId: appartement.id,
      typeBail: "vide",
      dateDebut: "2026-01-01",
      loyerMensuel: "700.00"
    });
    return bail.id;
  }

  // Échéance de 700 € avec un versement de 100 €, puis archivée (cascade :
  // le versement est archivé avec elle).
  async function creerEcheanceArchivee() {
    return enA(async () => {
      const bailId = await creerBailBrouillon();
      const paiement = await paiementsService.create({
        bailId,
        type: "loyer",
        montant: "700.00",
        dateEcheance: "2026-02-05"
      });
      await versementsService.ajouter({
        paiementId: paiement.id,
        montant: "100.00",
        mode: "virement",
        dateVersement: "2026-02-05"
      });
      await paiementsService.archive(paiement.id);
      return { bailId, paiementId: paiement.id };
    });
  }

  async function lignePaiement(id: string) {
    const [ligne] = await db.select().from(paiements).where(eq(paiements.id, id));
    return ligne;
  }

  async function nombre(table: typeof versements | typeof remboursements, paiementId: string): Promise<number> {
    const [ligne] = await db.select({ n: count() }).from(table).where(eq(table.paiementId, paiementId));
    return ligne?.n ?? 0;
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
        BienModule,
        AppartementsModule,
        BauxModule,
        StorageModule,
        PaiementsModule,
        VersementsModule,
        RemboursementsModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    requestContextService = moduleRef.get(RequestContextService);
    bauxService = moduleRef.get(BauxService);
    paiementsService = moduleRef.get(PaiementsService);
    versementsService = moduleRef.get(VersementsService);
    remboursementsService = moduleRef.get(RemboursementsService);

    const a = await creerOrganisation("A");
    orgB = await creerOrganisation("B");
    orgA = { ...a, bienId: "" };
    const bienFixture = await enA(() =>
      moduleRef.get(BienService).create(a.userId, {
        type: "maison",
        proprietaireType: "personne_physique",
        nomProprietaire: "Propriétaire Échéances archivées",
        adresse: "1 rue de Test",
        codePostal: "75001",
        ville: "Paris"
      })
    );
    orgA = { ...a, bienId: bienFixture.id };
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
    await rm(storageDirTest, { recursive: true, force: true });
  });

  describe("versement sur une échéance archivée", () => {
    it("refusé (409), aucun versement créé, échéance inchangée", async () => {
      const { paiementId } = await creerEcheanceArchivee();
      const avant = await lignePaiement(paiementId);
      const versementsAvant = await nombre(versements, paiementId);

      const appel = enA(() =>
        versementsService.ajouter({
          paiementId,
          montant: "50.00",
          mode: "virement",
          dateVersement: "2026-02-06"
        })
      );
      await expect(appel).rejects.toThrow(ConflictException);
      await expect(appel).rejects.toThrow(MESSAGE_VERSEMENT_ECHEANCE_ARCHIVEE);
      expect(await nombre(versements, paiementId)).toBe(versementsAvant);
      expect(await lignePaiement(paiementId)).toEqual(avant);
    });

    // Confirmation d'un rapprochement CSV : même route (POST /versements,
    // ImportCsvFusionneView.handleConfirmerRapprochement), avec la
    // référence de la ligne de relevé.
    it("rapprochement CSV : la confirmation sur une échéance archivée est refusée de la même façon", async () => {
      const { paiementId } = await creerEcheanceArchivee();
      await expect(
        enA(() =>
          versementsService.ajouter({
            paiementId,
            montant: "50.00",
            mode: "virement",
            dateVersement: "2026-02-06",
            referenceRapprochement: "VIR LOYER FEVRIER"
          })
        )
      ).rejects.toThrow(MESSAGE_VERSEMENT_ECHEANCE_ARCHIVEE);
      expect(await nombre(versements, paiementId)).toBe(1);
    });

    it("échéance archivée d'une autre organisation : 404, pas 409", async () => {
      const { paiementId } = await creerEcheanceArchivee();
      await expect(
        enB(() =>
          versementsService.ajouter({
            paiementId,
            montant: "50.00",
            mode: "virement",
            dateVersement: "2026-02-06"
          })
        )
      ).rejects.toThrow(NotFoundException);
    });

    it("échéance NON archivée : versement accepté et statut recalculé (non-régression)", async () => {
      const paiementId = await enA(async () => {
        const bailId = await creerBailBrouillon();
        return (
          await paiementsService.create({
            bailId,
            type: "loyer",
            montant: "700.00",
            dateEcheance: "2026-02-05"
          })
        ).id;
      });
      await enA(() =>
        versementsService.ajouter({
          paiementId,
          montant: "700.00",
          mode: "virement",
          dateVersement: "2026-02-05"
        })
      );
      expect((await lignePaiement(paiementId))?.statut).toBe("paye");
    });
  });

  describe("remboursement lié à une échéance archivée", () => {
    it("refusé (409), aucun remboursement créé", async () => {
      const { bailId, paiementId } = await creerEcheanceArchivee();

      const appel = enA(() =>
        remboursementsService.create({
          bailId,
          paiementId,
          type: "trop_percu",
          montantOrigine: "50.00",
          montantRembourse: "50.00",
          dateRemboursement: "2026-03-01",
          mode: "virement"
        })
      );
      await expect(appel).rejects.toThrow(ConflictException);
      await expect(appel).rejects.toThrow(MESSAGE_REMBOURSEMENT_ECHEANCE_ARCHIVEE);
      expect(await nombre(remboursements, paiementId)).toBe(0);
    });

    // Sans versement actif, le plafond « montant réellement reçu » refusait
    // déjà par hasard (la cascade d'archivage a archivé les versements).
    // Avec un versement resté actif (possible avant ce commit), le
    // remboursement passait.
    it("refusé (409) même avec un versement resté actif sur l'échéance archivée", async () => {
      const { bailId, paiementId } = await creerEcheanceArchivee();
      await db
        .insert(versements)
        .values({ paiementId, montant: "60.00", dateVersement: "2026-02-07", mode: "virement" });

      await expect(
        enA(() =>
          remboursementsService.create({
            bailId,
            paiementId,
            type: "trop_percu",
            montantOrigine: "50.00",
            montantRembourse: "50.00",
            dateRemboursement: "2026-03-01",
            mode: "virement"
          })
        )
      ).rejects.toThrow(MESSAGE_REMBOURSEMENT_ECHEANCE_ARCHIVEE);
      expect(await nombre(remboursements, paiementId)).toBe(0);
    });

    it("échéance archivée d'une autre organisation : 404, pas 409", async () => {
      const { bailId, paiementId } = await creerEcheanceArchivee();
      await expect(
        enB(() =>
          remboursementsService.create({
            bailId,
            paiementId,
            type: "trop_percu",
            montantOrigine: "50.00",
            montantRembourse: "50.00",
            dateRemboursement: "2026-03-01",
            mode: "virement"
          })
        )
      ).rejects.toThrow(NotFoundException);
    });

    // Décision du 2026-11-22 soir : un bail ne se désarchive jamais, le
    // dépôt de garantie d'un bail archivé doit pouvoir être restitué.
    it("bail archivé : remboursement accepté (non-régression)", async () => {
      const bailId = await enA(() => creerBailBrouillon());
      await enA(() => bauxService.archive(bailId));
      const [bail] = await db.select().from(baux).where(eq(baux.id, bailId));
      expect(bail?.archivedAt).not.toBeNull();

      const remboursement = await enA(() =>
        remboursementsService.create({
          bailId,
          type: "depot_garantie",
          montantOrigine: "700.00",
          montantRembourse: "700.00",
          dateRemboursement: "2026-03-01",
          mode: "virement"
        })
      );
      expect(remboursement.bailId).toBe(bailId);
    });
  });

  // Versement resté ACTIF sur une échéance archivée : impossible désormais,
  // mais possible avant ce commit (VersementsService.ajouter l'acceptait).
  // Son annulation ne doit pas réécrire le statut de l'échéance archivée.
  describe("recalcul du statut d'une échéance archivée", () => {
    it("annuler un versement resté actif sur une échéance archivée : versement annulé, échéance inchangée", async () => {
      const { paiementId } = await creerEcheanceArchivee();
      const [versementAncien] = await db
        .insert(versements)
        .values({ paiementId, montant: "60.00", dateVersement: "2026-02-07", mode: "virement" })
        .returning();
      const avant = await lignePaiement(paiementId);

      const annule = await enA(() => versementsService.annuler(versementAncien!.id));
      expect(annule.archivedAt).not.toBeNull();
      expect(await lignePaiement(paiementId)).toEqual(avant);
    });
  });
});
