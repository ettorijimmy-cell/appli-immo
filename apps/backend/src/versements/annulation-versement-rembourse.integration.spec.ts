import { randomUUID } from "crypto";
import { rm } from "fs/promises";
import os from "os";
import path from "path";
import { ConflictException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  organisations,
  paiements,
  remboursements,
  utilisateurs,
  versements,
  type Database
} from "db";
import { eq } from "drizzle-orm";
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
import { PaiementsModule } from "../paiements/paiements.module";
import { PaiementsService } from "../paiements/paiements.service";
import { RemboursementsModule } from "../remboursements/remboursements.module";
import { RemboursementsService } from "../remboursements/remboursements.service";
import { StorageModule } from "../storage/storage.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { VersementsModule } from "./versements.module";
import { VersementsService } from "./versements.service";

// Commit 5 des petites suites, remarque 7 (décision du 2026-11-22) :
// annuler un versement est refusé (409) SEULEMENT si, après annulation, le
// total remboursé lié à l'échéance dépasserait le total reçu ; le message
// invite à archiver d'abord le remboursement. Cas séquentiels ; la course
// avec une création de remboursement est vérifiée en vrai parallèle dans
// paiements/echeances-verrou-bail-concurrence.integration.spec.ts.
//
// Même fichier (compléments du 2026-11-23) : archiver une ÉCHÉANCE qui porte
// des remboursements actifs est refusé (409), sous le verrou du bail, avant
// la cascade sur ses versements — sinon « remboursé ≤ reçu » était contourné.

describe("Annulation d'un versement déjà remboursé (intégration Postgres réelle)", () => {
  const storageDirTest = path.join(os.tmpdir(), `appli-immo-test-annulation-rembourse-${randomUUID()}`);
  process.env["DOCUMENTS_STORAGE_DIR"] = storageDirTest;

  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let requestContextService: RequestContextService;
  let paiementsService: PaiementsService;
  let versementsService: VersementsService;
  let remboursementsService: RemboursementsService;
  let contexte: { utilisateurId: string; organisationId: string };
  let bienId: string;

  function enA<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte(contexte, fn);
  }

  // Échéance de 700 € d'un bail brouillon, avec les versements donnés.
  async function creerEcheance(...montantsVersements: string[]) {
    return creerEcheanceDeType("loyer", ...montantsVersements);
  }

  async function creerEcheanceDeType(type: "loyer" | "depot_garantie", ...montantsVersements: string[]) {
    return enA(async () => {
      const appartement = await moduleRef.get(AppartementsService).create({
        bienId,
        numero: `R-${randomUUID().slice(0, 6)}`,
        type: "T2",
        nombrePiecesPrincipales: 2,
        modeChauffage: "individuel",
        modeEauChaude: "individuel"
      });
      const bail = await moduleRef.get(BauxService).create({
        appartementId: appartement.id,
        typeBail: "vide",
        dateDebut: "2026-01-01",
        loyerMensuel: "700.00"
      });
      const paiement = await paiementsService.create({
        bailId: bail.id,
        type,
        montant: "700.00",
        dateEcheance: "2026-02-05"
      });
      const ids: string[] = [];
      for (const montant of montantsVersements) {
        ids.push(
          (await versementsService.ajouter({ paiementId: paiement.id, montant, mode: "virement", dateVersement: "2026-02-05" }))
            .id
        );
      }
      return { bailId: bail.id, paiementId: paiement.id, versementIds: ids };
    });
  }

  function rembourser(
    bailId: string,
    paiementId: string | undefined,
    montant: string,
    type: "trop_percu" | "depot_garantie" = "trop_percu"
  ) {
    return enA(() =>
      remboursementsService.create({
        bailId,
        ...(paiementId ? { paiementId } : {}),
        type,
        montantOrigine: montant,
        montantRembourse: montant,
        dateRemboursement: "2026-03-01",
        mode: "virement"
      })
    );
  }

  async function ligne<T extends typeof versements | typeof paiements>(table: T, id: string) {
    const [l] = await db.select().from(table).where(eq(table.id, id));
    return l;
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
    paiementsService = moduleRef.get(PaiementsService);
    versementsService = moduleRef.get(VersementsService);
    remboursementsService = moduleRef.get(RemboursementsService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Annulation remboursée" })
      .returning();
    const [utilisateur] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation!.id,
        email: `annulation-rembourse-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "AnnulationRembourse",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    contexte = { utilisateurId: utilisateur!.id, organisationId: organisation!.id };
    bienId = (
      await enA(() =>
        moduleRef.get(BienService).create(contexte.utilisateurId, {
          type: "maison",
          proprietaireType: "personne_physique",
          nomProprietaire: "Propriétaire",
          adresse: "1 rue de Test",
          codePostal: "75001",
          ville: "Paris"
        })
      )
    ).id;
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
    await rm(storageDirTest, { recursive: true, force: true });
  });

  it("le remboursement dépasserait le reçu restant → 409, versement et échéance inchangés", async () => {
    const { bailId, paiementId, versementIds } = await creerEcheance("100.00");
    await rembourser(bailId, paiementId, "60.00");
    const avantVersement = await ligne(versements, versementIds[0]!);
    const avantEcheance = await ligne(paiements, paiementId);

    const appel = enA(() => versementsService.annuler(versementIds[0]!));
    await expect(appel).rejects.toThrow(ConflictException);
    await expect(appel).rejects.toThrow(
      "Impossible d'annuler ce versement : 60.00 € ont déjà été remboursés sur cette échéance, il n'en resterait que 0.00 € reçus. Archivez d'abord le remboursement."
    );
    expect(await ligne(versements, versementIds[0]!)).toEqual(avantVersement);
    expect(await ligne(paiements, paiementId)).toEqual(avantEcheance);
  });

  it("le reçu restant couvre encore le remboursement → annulation acceptée", async () => {
    const { bailId, paiementId, versementIds } = await creerEcheance("100.00", "100.00");
    await rembourser(bailId, paiementId, "60.00");

    const annule = await enA(() => versementsService.annuler(versementIds[0]!));
    expect(annule.archivedAt).not.toBeNull();
  });

  it("égalité exacte (reçu restant = remboursé) → annulation acceptée", async () => {
    const { bailId, paiementId, versementIds } = await creerEcheance("60.00", "40.00");
    await rembourser(bailId, paiementId, "60.00");

    const annule = await enA(() => versementsService.annuler(versementIds[1]!));
    expect(annule.archivedAt).not.toBeNull();
  });

  it("remboursement archivé d'abord → annulation acceptée", async () => {
    const { bailId, paiementId, versementIds } = await creerEcheance("100.00");
    const remboursement = await rembourser(bailId, paiementId, "60.00");
    await enA(() => remboursementsService.archive(remboursement.id));

    const annule = await enA(() => versementsService.annuler(versementIds[0]!));
    expect(annule.archivedAt).not.toBeNull();
  });

  // --- Cas ajoutés après la revue financial-logic-reviewer du commit 5 ---

  it("dépassement d'un centime (60.01 € remboursés, 60.00 € restants) → 409", async () => {
    const { bailId, paiementId, versementIds } = await creerEcheance("60.00", "0.01");
    await rembourser(bailId, paiementId, "60.01");

    await expect(enA(() => versementsService.annuler(versementIds[1]!))).rejects.toThrow(
      "Impossible d'annuler ce versement : 60.01 € ont déjà été remboursés sur cette échéance, il n'en resterait que 60.00 € reçus. Archivez d'abord le remboursement."
    );
  });

  it("dépôt de garantie restitué : même refus", async () => {
    const { bailId, paiementId, versementIds } = await creerEcheanceDeType("depot_garantie", "700.00");
    await rembourser(bailId, paiementId, "700.00", "depot_garantie");

    await expect(enA(() => versementsService.annuler(versementIds[0]!))).rejects.toThrow(
      "Impossible d'annuler ce versement : 700.00 € ont déjà été remboursés sur cette échéance, il n'en resterait que 0.00 € reçus. Archivez d'abord le remboursement."
    );
  });

  it("un remboursement d'une AUTRE échéance du même bail ne compte pas", async () => {
    const premiere = await creerEcheance("100.00");
    // Seconde échéance sur le même bail, remboursée.
    const seconde = await enA(() =>
      paiementsService.create({ bailId: premiere.bailId, type: "loyer", montant: "700.00", dateEcheance: "2026-03-05" })
    );
    await enA(() =>
      versementsService.ajouter({ paiementId: seconde.id, montant: "100.00", mode: "virement", dateVersement: "2026-03-05" })
    );
    await rembourser(premiere.bailId, seconde.id, "60.00");

    const annule = await enA(() => versementsService.annuler(premiere.versementIds[0]!));
    expect(annule.archivedAt).not.toBeNull();
  });

  it("un remboursement sans échéance liée (au niveau du bail) ne compte pas", async () => {
    const { bailId, versementIds } = await creerEcheance("100.00");
    await rembourser(bailId, undefined, "60.00");

    const annule = await enA(() => versementsService.annuler(versementIds[0]!));
    expect(annule.archivedAt).not.toBeNull();
  });

  it("versement déjà annulé : « Déjà annulé » passe avant ce refus", async () => {
    const { bailId, paiementId } = await creerEcheance("100.00");
    await rembourser(bailId, paiementId, "60.00");
    // Versement déjà annulé (inséré tel quel) : un refus « remboursé » ne
    // doit jamais masquer le 409 « Déjà annulé ».
    const [dejaAnnule] = await db
      .insert(versements)
      .values({ paiementId, montant: "50.00", dateVersement: "2026-02-06", mode: "virement", archivedAt: new Date() })
      .returning();

    await expect(enA(() => versementsService.annuler(dejaAnnule!.id))).rejects.toThrow(/^Déjà annulé le /);
  });

  it("annulation acceptée : le statut de l'échéance est recalculé (payé → partiel)", async () => {
    const { bailId, paiementId, versementIds } = await creerEcheance("600.00", "100.00");
    await rembourser(bailId, paiementId, "60.00");
    expect((await ligne(paiements, paiementId))?.statut).toBe("paye");

    await enA(() => versementsService.annuler(versementIds[1]!));
    expect((await ligne(paiements, paiementId))?.statut).toBe("partiel");
  });

  it("aucun remboursement → annulation acceptée (non-régression)", async () => {
    const { versementIds } = await creerEcheance("100.00");
    const annule = await enA(() => versementsService.annuler(versementIds[0]!));
    expect(annule.archivedAt).not.toBeNull();
  });

  describe("archivage d'une échéance qui porte des remboursements", () => {
    async function versementsActifs(paiementId: string) {
      return (await db.select().from(versements).where(eq(versements.paiementId, paiementId))).filter(
        (v) => v.archivedAt === null
      );
    }

    it("un remboursement actif → 409, échéance et versements intacts", async () => {
      const { bailId, paiementId } = await creerEcheance("100.00");
      await rembourser(bailId, paiementId, "60.00");
      const avant = await ligne(paiements, paiementId);

      const erreur = await enA(() => paiementsService.archive(paiementId)).catch((e: unknown) => e);
      expect(erreur).toBeInstanceOf(ConflictException);
      expect((erreur as Error).message).toBe(
        "Impossible d'archiver cette échéance : elle porte 1 remboursement (60.00 €). Archivez d'abord le remboursement."
      );
      const apres = await ligne(paiements, paiementId);
      expect(apres?.archivedAt).toBeNull();
      expect(apres?.version).toBe(avant?.version);
      expect(await versementsActifs(paiementId)).toHaveLength(1);
    });

    it("deux remboursements actifs → 409 au pluriel, avec leur total", async () => {
      const { bailId, paiementId } = await creerEcheance("100.00");
      await rembourser(bailId, paiementId, "60.00");
      await rembourser(bailId, paiementId, "15.50");

      await expect(enA(() => paiementsService.archive(paiementId))).rejects.toThrow(
        "Impossible d'archiver cette échéance : elle porte 2 remboursements (75.50 € au total). Archivez d'abord les remboursements."
      );
    });

    it("dépôt de garantie retenu en totalité (remboursement à 0 €) → 409 aussi", async () => {
      const { bailId, paiementId } = await creerEcheanceDeType("depot_garantie", "700.00");
      // Insertion directe : la retenue exige un justificatif en pièce jointe
      // (hors sujet ici) ; seule compte la ligne active à 0 €.
      await db.insert(remboursements).values({
        bailId,
        paiementId,
        type: "depot_garantie",
        montantOrigine: "700.00",
        montantRembourse: "0.00",
        motifRetenue: "degradation_locative",
        dateRemboursement: "2026-03-01",
        mode: "virement"
      });

      await expect(enA(() => paiementsService.archive(paiementId))).rejects.toThrow(
        "Impossible d'archiver cette échéance : elle porte 1 remboursement (0.00 €). Archivez d'abord le remboursement."
      );
      expect(await versementsActifs(paiementId)).toHaveLength(1);
    });

    it("remboursement archivé d'abord → l'échéance s'archive, versements archivés en cascade", async () => {
      const { bailId, paiementId } = await creerEcheance("100.00");
      const remboursement = await rembourser(bailId, paiementId, "60.00");
      await enA(() => remboursementsService.archive(remboursement.id));

      const archivee = await enA(() => paiementsService.archive(paiementId));
      expect(archivee.archivedAt).not.toBeNull();
      expect(await versementsActifs(paiementId)).toHaveLength(0);
    });

    it("un remboursement d'une autre échéance ou sans échéance liée ne compte pas", async () => {
      const premiere = await creerEcheance("100.00");
      const seconde = await enA(() =>
        paiementsService.create({ bailId: premiere.bailId, type: "loyer", montant: "700.00", dateEcheance: "2026-03-05" })
      );
      await enA(() =>
        versementsService.ajouter({ paiementId: seconde.id, montant: "100.00", mode: "virement", dateVersement: "2026-03-05" })
      );
      await rembourser(premiere.bailId, seconde.id, "60.00");
      await rembourser(premiere.bailId, undefined, "40.00");

      const archivee = await enA(() => paiementsService.archive(premiere.paiementId));
      expect(archivee.archivedAt).not.toBeNull();
    });

    it("échéance déjà archivée : « Déjà archivé » passe avant ce refus", async () => {
      const { bailId, paiementId } = await creerEcheance("100.00");
      await rembourser(bailId, paiementId, "60.00");
      await db.update(paiements).set({ archivedAt: new Date() }).where(eq(paiements.id, paiementId));

      await expect(enA(() => paiementsService.archive(paiementId))).rejects.toThrow(/^Déjà archivé le /);
    });
  });
});
