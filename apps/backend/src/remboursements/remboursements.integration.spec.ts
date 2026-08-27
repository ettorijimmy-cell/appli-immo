import { randomUUID } from "crypto";
import { rm } from "fs/promises";
import os from "os";
import path from "path";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, utilisateurs, type Database } from "db";
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
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { PaiementsModule } from "../paiements/paiements.module";
import { PaiementsService } from "../paiements/paiements.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
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

// Vérifie les décisions de conception "versements & remboursements"
// (docs/data-dictionary.md) : un remboursement est toujours un acte
// humain explicite (jamais créé automatiquement), plusieurs remboursements
// partiels sont autorisés sur un même paiement d'origine tant que leur
// somme ne dépasse jamais le montant réellement reçu (rejet strict, sans
// exception).
describe("Remboursements — validations D3/D4 (intégration Postgres réelle)", () => {
  const storageDirTest = path.join(os.tmpdir(), `appli-immo-test-remboursements-${randomUUID()}`);
  process.env["DOCUMENTS_STORAGE_DIR"] = storageDirTest;

  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let paiementsService: PaiementsService;
  let versementsService: VersementsService;
  let remboursementsService: RemboursementsService;
  let db: Database;
  let bailId: string;
  let depotGarantiePaiementId: string;

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

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Remboursements Intégration" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }

    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `remboursements-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Remboursements",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }

    const sci = await scisService.create(user.id, { nom: "SCI Remboursements Test", regimeFiscal: "IR", adresse: "1 rue de Test", codePostal: "75001", ville: "Paris" });
    const bien = await bienService.create(user.id, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Remboursements Test",
      adresse: "1 rue des Remboursements",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: "1",
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
    bailId = bail.id;

    // activer() a généré le paiement type=depot_garantie et la première
    // échéance de loyer. On isole le dépôt de garantie et on simule son
    // versement intégral par le locataire.
    const tousLesPaiements = await paiementsService.findAll(bailId);
    const depotGarantiePaiement = tousLesPaiements.find((p) => p.type === "depot_garantie");
    if (!depotGarantiePaiement) {
      throw new Error("Paiement dépôt de garantie introuvable après activation");
    }
    depotGarantiePaiementId = depotGarantiePaiement.id;
    await versementsService.ajouter({
      paiementId: depotGarantiePaiementId,
      montant: "1000.00",
      mode: "virement",
      dateVersement: "2026-01-01"
    });
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
    await rm(storageDirTest, { recursive: true, force: true });
  });

  it("rejette un bailId inexistant avant toute écriture de pièce jointe (pas de blob orphelin)", async () => {
    await expect(
      remboursementsService.create(
        {
          bailId: randomUUID(),
          type: "depot_garantie",
          montantOrigine: "1000.00",
          montantRembourse: "750.00",
          dateRemboursement: "2026-07-15",
          mode: "virement",
          motifRetenue: "degradation_locative"
        },
        fichierTest("ne doit jamais être écrit")
      )
    ).rejects.toThrow(NotFoundException);
  });

  it("crée un remboursement du dépôt de garantie intégral, avec commentaire", async () => {
    const remboursement = await remboursementsService.create({
      bailId,
      paiementId: depotGarantiePaiementId,
      type: "depot_garantie",
      montantOrigine: "1000.00",
      montantRembourse: "1000.00",
      commentaire: "Restitution intégrale, aucune dégradation constatée",
      dateRemboursement: "2026-07-15",
      mode: "virement"
    });

    expect(remboursement.type).toBe("depot_garantie");
    expect(remboursement.montantRembourse).toBe("1000.00");
    expect(remboursement.commentaire).toBe("Restitution intégrale, aucune dégradation constatée");
  });

  it("autorise plusieurs remboursements partiels successifs tant que leur somme ne dépasse pas le montant reçu", async () => {
    // Tout remboursement partiel d'un dépôt de garantie est une retenue au
    // sens de la loi (montant_rembourse < montant_origine) : motif +
    // justificatif requis sur les deux, comme sur un seul remboursement
    // partiel.
    await remboursementsService.create(
      {
        bailId,
        paiementId: depotGarantiePaiementId,
        type: "depot_garantie",
        montantOrigine: "1000.00",
        montantRembourse: "600.00",
        dateRemboursement: "2026-07-15",
        mode: "virement",
        motifRetenue: "degradation_locative"
      },
      fichierTest("devis peinture")
    );

    // Second remboursement plus tard (ex. après résolution d'un litige sur
    // le solde) : 600 + 400 = 1000, exactement le montant reçu.
    const second = await remboursementsService.create(
      {
        bailId,
        paiementId: depotGarantiePaiementId,
        type: "depot_garantie",
        montantOrigine: "1000.00",
        montantRembourse: "400.00",
        commentaire: "Solde après retenue négociée",
        dateRemboursement: "2026-08-01",
        mode: "virement",
        motifRetenue: "charges_impayees"
      },
      fichierTest("décompte de charges")
    );

    expect(second.montantRembourse).toBe("400.00");

    const tous = await remboursementsService.findAll(bailId);
    expect(tous).toHaveLength(2);
  });

  it("rejette explicitement un remboursement qui dépasserait le montant réellement reçu, rejet strict sans exception", async () => {
    await remboursementsService.create(
      {
        bailId,
        paiementId: depotGarantiePaiementId,
        type: "depot_garantie",
        montantOrigine: "1000.00",
        montantRembourse: "700.00",
        dateRemboursement: "2026-07-15",
        mode: "virement",
        motifRetenue: "loyers_impayes"
      },
      fichierTest("décompte loyers impayés")
    );

    // 700 + 400 = 1100 > 1000 reçus : rejeté, même si l'écart est faible.
    await expect(
      remboursementsService.create({
        bailId,
        paiementId: depotGarantiePaiementId,
        type: "depot_garantie",
        montantOrigine: "1000.00",
        montantRembourse: "400.00",
        dateRemboursement: "2026-08-01",
        mode: "virement"
      })
    ).rejects.toThrow(ConflictException);

    // Rien n'a été créé pour la tentative rejetée.
    const tous = await remboursementsService.findAll(bailId);
    expect(tous).toHaveLength(1);
  });

  it("retenue sur dégradations : montant_rembourse peut différer de montant_origine, avec motif structuré et pièce justificative chiffrée", async () => {
    const remboursement = await remboursementsService.create(
      {
        bailId,
        paiementId: depotGarantiePaiementId,
        type: "depot_garantie",
        montantOrigine: "1000.00",
        montantRembourse: "750.00",
        commentaire: "Retenue de 250 € : peinture à refaire (état des lieux de sortie)",
        dateRemboursement: "2026-07-15",
        mode: "virement",
        motifRetenue: "degradation_locative"
      },
      fichierTest("devis peinture 250 euros")
    );

    expect(remboursement.montantOrigine).toBe("1000.00");
    expect(remboursement.montantRembourse).toBe("750.00");
    expect(remboursement.commentaire).toContain("Retenue");
    expect(remboursement.motifRetenue).toBe("degradation_locative");
    expect(remboursement.pieceJustificativeNomFichier).toBe("devis-peinture.pdf");
    expect(remboursement.pieceJustificativeMimeType).toBe("application/pdf");
    // pieceJustificativeChemin ne doit jamais apparaître dans la projection
    // exposée à l'API — même règle que documents.cheminStockage.
    expect(remboursement).not.toHaveProperty("pieceJustificativeChemin");

    const { contenu, nomFichier } = await remboursementsService.telechargerPieceJustificative(remboursement.id);
    expect(contenu.toString("utf8")).toBe("devis peinture 250 euros");
    expect(nomFichier).toBe("devis-peinture.pdf");
  });

  it("rejette une retenue sans motif ou sans pièce jointe (les deux sont requis ensemble)", async () => {
    await expect(
      remboursementsService.create({
        bailId,
        paiementId: depotGarantiePaiementId,
        type: "depot_garantie",
        montantOrigine: "1000.00",
        montantRembourse: "750.00",
        dateRemboursement: "2026-07-15",
        mode: "virement"
        // ni motifRetenue ni fichier alors que 750 < 1000 : retenue réelle non justifiée.
      })
    ).rejects.toThrow(BadRequestException);

    await expect(
      remboursementsService.create(
        {
          bailId,
          paiementId: depotGarantiePaiementId,
          type: "depot_garantie",
          montantOrigine: "1000.00",
          montantRembourse: "750.00",
          dateRemboursement: "2026-07-15",
          mode: "virement",
          motifRetenue: "degradation_locative"
          // motif fourni mais pas de fichier.
        }
        // pas de fichier
      )
    ).rejects.toThrow(BadRequestException);

    const tous = await remboursementsService.findAll(bailId);
    expect(tous).toHaveLength(0);
  });

  it("rejette un motif de retenue fourni hors retenue réelle (remboursement intégral)", async () => {
    await expect(
      remboursementsService.create(
        {
          bailId,
          paiementId: depotGarantiePaiementId,
          type: "depot_garantie",
          montantOrigine: "1000.00",
          montantRembourse: "1000.00",
          dateRemboursement: "2026-07-15",
          mode: "virement",
          motifRetenue: "autre"
        },
        fichierTest("justificatif superflu")
      )
    ).rejects.toThrow(BadRequestException);
  });

  it("un remboursement archivé n'entre plus dans le calcul de la somme déjà remboursée", async () => {
    const premier = await remboursementsService.create({
      bailId,
      paiementId: depotGarantiePaiementId,
      type: "depot_garantie",
      montantOrigine: "1000.00",
      montantRembourse: "1000.00",
      dateRemboursement: "2026-07-15",
      mode: "virement"
    });

    // Erreur de saisie détectée après coup : le remboursement est archivé
    // (jamais supprimé physiquement).
    const archive = await remboursementsService.archive(premier.id);
    expect(archive.archivedAt).not.toBeNull();

    // Un nouveau remboursement complet redevient possible : l'ancien,
    // archivé, ne compte plus dans la somme.
    const corrige = await remboursementsService.create({
      bailId,
      paiementId: depotGarantiePaiementId,
      type: "depot_garantie",
      montantOrigine: "1000.00",
      montantRembourse: "1000.00",
      dateRemboursement: "2026-07-16",
      mode: "virement"
    });
    expect(corrige.montantRembourse).toBe("1000.00");
  });

  it("trop-perçu (type distinct) : même validation, appliquée à un paiement de loyer plutôt qu'un dépôt", async () => {
    const paiementLoyer = await paiementsService.create({
      bailId,
      type: "loyer",
      montant: "500.00",
      dateEcheance: "2026-06-05"
    });
    // Trop-perçu de 300 € (800 € versés pour 500 € dus, par exemple après
    // une proration de résiliation réduisant le montant dû après coup).
    await versementsService.ajouter({
      paiementId: paiementLoyer.id,
      montant: "800.00",
      mode: "virement",
      dateVersement: "2026-06-05"
    });

    const remboursement = await remboursementsService.create({
      bailId,
      paiementId: paiementLoyer.id,
      type: "trop_percu",
      montantOrigine: "300.00",
      montantRembourse: "300.00",
      dateRemboursement: "2026-07-01",
      mode: "virement"
    });
    expect(remboursement.type).toBe("trop_percu");

    // Rejeté : la validation porte sur le montant réellement reçu SUR CE
    // PAIEMENT (800 €), pas sur montant_origine — tenter de rembourser
    // au-delà de 800 € au total est refusé.
    await expect(
      remboursementsService.create({
        bailId,
        paiementId: paiementLoyer.id,
        type: "trop_percu",
        montantOrigine: "300.00",
        montantRembourse: "600.00",
        dateRemboursement: "2026-07-02",
        mode: "virement"
      })
    ).rejects.toThrow(ConflictException);
  });
});
