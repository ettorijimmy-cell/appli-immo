import { randomUUID } from "crypto";
import { rm } from "fs/promises";
import os from "os";
import path from "path";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, remboursements, utilisateurs, type Database } from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuditModule } from "../audit/audit.module";
import { AuditService } from "../audit/audit.service";
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
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { DocumentStorageService } from "../storage/document-storage.service";
import { StorageModule } from "../storage/storage.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { VersementsModule } from "../versements/versements.module";
import { VersementsService } from "../versements/versements.service";
import { RemboursementsModule } from "./remboursements.module";
import { RemboursementsService } from "./remboursements.service";

function fichierTest(contenu: string, nom = "devis-peinture.pdf"): Express.Multer.File {
  return {
    originalname: nom,
    mimetype: "application/pdf",
    buffer: Buffer.from(contenu, "utf8"),
    size: Buffer.byteLength(contenu, "utf8")
  } as Express.Multer.File;
}

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  remboursementId: string;
  bailId: string;
  paiementId: string;
}

// Commit B5 (chantier scoping multi-organisation, 2026-09-18) :
// telechargerPieceJustificative(id) refait sa propre requête SQL
// (remboursement -> bail -> appartement -> bien), même raisonnement que
// B1/B2/B4. La pièce jointe est chiffrée sur disque (storage.lire avec
// chiffrer:true) — le spy porte directement sur cette méthode publique,
// jamais un cast `any` sur du privé.
//
// archive() n'était pas protégée par ce commit (Catégorie C, audit séparé)
// — corrigée en Priorité 3b (2026-09-19) via verifierAppartenanceRemboursement(),
// le même helper privé que telechargerPieceJustificative() ci-dessus
// (message paramétré : "Remboursement introuvable" pour archive(), "Pièce
// justificative introuvable" pour telechargerPieceJustificative() — jamais
// de différence observable entre "n'existe pas" et "d'une autre
// organisation" au sein de chaque appelant).
//
// create() (Priorité E3, chantier scoping multi-organisation, Catégorie E,
// 2026-09-19) : dto.bailId et dto.paiementId (optionnel) n'étaient vérifiés
// ni pour leur existence ni pour leur appartenance — corrigé en filtrant
// les deux requêtes déjà exécutées via jointure vers bien. Ne vérifie PAS
// que dto.paiementId appartient au même bail que dto.bailId — incohérence
// possible non corrigée ici (un paiement d'un autre bail de la MÊME
// organisation resterait accepté), signalée dans le compte-rendu de ce
// commit plutôt que corrigée en silence : hors sujet direct du scoping.
// Aucun appelant interne (vérifié par grep, seul RemboursementsController).
describe("RemboursementsService — contrôle d'appartenance à l'organisation (intégration Postgres réelle)", () => {
  const storageDirTest = path.join(os.tmpdir(), `appli-immo-test-remboursements-scoping-${randomUUID()}`);
  process.env["DOCUMENTS_STORAGE_DIR"] = storageDirTest;

  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let paiementsService: PaiementsService;
  let versementsService: VersementsService;
  let remboursementsService: RemboursementsService;
  let requestContextService: RequestContextService;
  let auditService: AuditService;
  let documentStorageService: DocumentStorageService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Remboursements Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `remboursements-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `RemboursementsScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    const userId = user.id;

    const sci = await scisService.create(userId, {
      nom: `SCI Remboursements Scoping ${suffixe}`,
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: `Immeuble Remboursements Scoping ${suffixe}`,
      adresse: "1 rue des Remboursements",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: suffixe,
      type: "T2",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel",
      loyerReference: "800.00"
    });
    const bail = await bauxService.create({
      appartementId: appartement.id,
      typeBail: "vide",
      dateDebut: "2026-01-01",
      loyerMensuel: "800.00",
      depotGarantie: "1000.00",
      jourEcheance: 5
    });
    await bauxService.activer(bail.id);

    const tousLesPaiements = await paiementsService.findAll(bail.id);
    const depotGarantiePaiement = tousLesPaiements.find((p) => p.type === "depot_garantie");
    if (!depotGarantiePaiement) {
      throw new Error("Paiement dépôt de garantie introuvable après activation");
    }
    await versementsService.ajouter({
      paiementId: depotGarantiePaiement.id,
      montant: "1000.00",
      mode: "virement",
      dateVersement: "2026-01-01"
    });

    // Retenue réelle (montantRembourse < montantOrigine) : seul cas où une
    // pièce justificative est effectivement écrite/chiffrée — condition
    // nécessaire pour que telechargerPieceJustificative ait quelque chose
    // à déchiffrer.
    const remboursement = await remboursementsService.create(
      {
        bailId: bail.id,
        paiementId: depotGarantiePaiement.id,
        type: "depot_garantie",
        montantOrigine: "1000.00",
        montantRembourse: "600.00",
        dateRemboursement: "2026-07-15",
        mode: "virement",
        motifRetenue: "degradation_locative"
      },
      fichierTest(`devis peinture ${suffixe}`, `devis-${suffixe}.pdf`)
    );

    return {
      organisationId: organisation.id,
      userId,
      remboursementId: remboursement.id,
      bailId: bail.id,
      paiementId: depotGarantiePaiement.id
    };
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
        BauxModule,
        PaiementsModule,
        VersementsModule,
        StorageModule,
        RemboursementsModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    bauxService = moduleRef.get(BauxService);
    paiementsService = moduleRef.get(PaiementsService);
    versementsService = moduleRef.get(VersementsService);
    remboursementsService = moduleRef.get(RemboursementsService);
    requestContextService = moduleRef.get(RequestContextService);
    auditService = moduleRef.get(AuditService);
    documentStorageService = moduleRef.get(DocumentStorageService);

    orgA = await creerFixtureOrganisation("A");
    orgB = await creerFixtureOrganisation("B");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
    await rm(storageDirTest, { recursive: true, force: true });
  });

  function contexteOrgA<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte({ utilisateurId: orgA.userId, organisationId: orgA.organisationId }, fn);
  }
  function contexteOrgB<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte({ utilisateurId: orgB.userId, organisationId: orgB.organisationId }, fn);
  }

  describe("create", () => {
    it("réussit normalement quand le bail (et le paiement, si fourni) appartiennent à l'organisation appelante", async () => {
      // 400.00 : la fixture a déjà consommé 600.00 des 1000.00 reçus sur ce
      // paiement (remboursement initial) — reste exactement 400.00 de marge
      // avant ConflictException (D3/D4), sans rapport avec ce commit.
      const remboursement = await contexteOrgA(() =>
        remboursementsService.create({
          bailId: orgA.bailId,
          paiementId: orgA.paiementId,
          type: "depot_garantie",
          montantOrigine: "400.00",
          montantRembourse: "400.00",
          dateRemboursement: "2026-08-01",
          mode: "virement"
        })
      );
      expect(remboursement.bailId).toBe(orgA.bailId);
    });

    it("404 sur le bailId d'une autre organisation, sans jamais créer de remboursement avec ce bailId", async () => {
      await expect(
        contexteOrgB(() =>
          remboursementsService.create({
            bailId: orgA.bailId,
            type: "depot_garantie",
            montantOrigine: "1000.00",
            montantRembourse: "1000.00",
            dateRemboursement: "2026-08-01",
            mode: "virement"
          })
        )
      ).rejects.toThrow(NotFoundException);

      const lignes = await db.select().from(remboursements).where(eq(remboursements.bailId, orgA.bailId));
      expect(lignes.map((l) => l.id)).toEqual([orgA.remboursementId]);
    });

    it("404 sur un bailId inexistant", async () => {
      await expect(
        contexteOrgA(() =>
          remboursementsService.create({
            bailId: randomUUID(),
            type: "depot_garantie",
            montantOrigine: "1000.00",
            montantRembourse: "1000.00",
            dateRemboursement: "2026-08-01",
            mode: "virement"
          })
        )
      ).rejects.toThrow(NotFoundException);
    });

    it("404 sur le paiementId d'une autre organisation (bailId pourtant valide), sans jamais créer de remboursement", async () => {
      await expect(
        contexteOrgA(() =>
          remboursementsService.create({
            bailId: orgA.bailId,
            paiementId: orgB.paiementId,
            type: "depot_garantie",
            montantOrigine: "1000.00",
            montantRembourse: "1000.00",
            dateRemboursement: "2026-08-01",
            mode: "virement"
          })
        )
      ).rejects.toThrow(NotFoundException);

      const lignes = await db.select().from(remboursements).where(eq(remboursements.bailId, orgA.bailId));
      expect(lignes.map((l) => l.id)).toEqual([orgA.remboursementId]);
    });

    it("404 sur un paiementId inexistant (bailId pourtant valide)", async () => {
      await expect(
        contexteOrgA(() =>
          remboursementsService.create({
            bailId: orgA.bailId,
            paiementId: randomUUID(),
            type: "depot_garantie",
            montantOrigine: "1000.00",
            montantRembourse: "1000.00",
            dateRemboursement: "2026-08-01",
            mode: "virement"
          })
        )
      ).rejects.toThrow(NotFoundException);
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      // Même marge de 400.00 que le test "réussit normalement" ci-dessus,
      // appliquée ici au paiement d'orgB.
      const remboursement = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        remboursementsService.create({
          bailId: orgB.bailId,
          paiementId: orgB.paiementId,
          type: "depot_garantie",
          montantOrigine: "400.00",
          montantRembourse: "400.00",
          dateRemboursement: "2026-08-01",
          mode: "virement"
        })
      );
      expect(remboursement.bailId).toBe(orgB.bailId);
    });
  });

  it("télécharge normalement la pièce justificative quand le remboursement appartient à l'organisation appelante", async () => {
    const resultat = await contexteOrgA(() =>
      remboursementsService.telechargerPieceJustificative(orgA.remboursementId)
    );
    expect(resultat.contenu.toString("utf8")).toContain("devis peinture A");
  });

  it("404 sur le remboursementId d'une autre organisation, sans jamais déchiffrer ni journaliser", async () => {
    const lireSpy = vi.spyOn(documentStorageService, "lire");
    const auditSpy = vi.spyOn(auditService, "logAccesDonneeSensible");

    await expect(
      contexteOrgB(() => remboursementsService.telechargerPieceJustificative(orgA.remboursementId))
    ).rejects.toThrow(NotFoundException);

    expect(lireSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it("404 sur un remboursementId inexistant, sans jamais déchiffrer", async () => {
    const lireSpy = vi.spyOn(documentStorageService, "lire");

    await expect(
      contexteOrgA(() => remboursementsService.telechargerPieceJustificative(randomUUID()))
    ).rejects.toThrow(NotFoundException);

    expect(lireSpy).not.toHaveBeenCalled();
  });

  it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
    const resultat = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
      remboursementsService.telechargerPieceJustificative(orgA.remboursementId)
    );
    expect(resultat.contenu.toString("utf8")).toContain("devis peinture A");
  });

  describe("archive", () => {
    it("réussit normalement quand le remboursement appartient à l'organisation appelante", async () => {
      const archive = await contexteOrgA(() => remboursementsService.archive(orgA.remboursementId));
      expect(archive.archivedAt).not.toBeNull();
    });

    it("404 sur le remboursementId d'une autre organisation, sans jamais archiver la ligne étrangère", async () => {
      await expect(contexteOrgB(() => remboursementsService.archive(orgA.remboursementId))).rejects.toThrow(
        NotFoundException
      );
      const [inchange] = await db.select().from(remboursements).where(eq(remboursements.id, orgA.remboursementId));
      expect(inchange?.archivedAt).toBeNull();
    });

    it("404 sur un remboursementId inexistant", async () => {
      await expect(contexteOrgA(() => remboursementsService.archive(randomUUID()))).rejects.toThrow(
        NotFoundException
      );
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const archive = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        remboursementsService.archive(orgA.remboursementId)
      );
      expect(archive.archivedAt).not.toBeNull();
    });
  });
});
