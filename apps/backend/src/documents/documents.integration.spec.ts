import { randomUUID } from "crypto";
import { readFile, readdir, rm } from "fs/promises";
import os from "os";
import path from "path";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  documents,
  journalAudit,
  organisations,
  utilisateurs,
  type Database
} from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { ImmeublesModule } from "../immeubles/immeubles.module";
import { ImmeublesService } from "../immeubles/immeubles.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { DocumentsModule } from "./documents.module";
import { DocumentsService } from "./documents.service";

// Vérifie le critère de complétion du Module 4 (docs/backlog.md) : glisser
// un document sur une fiche, le retrouver catégorisé dans l'écran Documents,
// vérifier qu'un document expiré change bien de statut. Chaque test tourne
// dans sa propre transaction Postgres annulée dans afterEach (voir
// test-utils/transactional-test.ts) — le stockage disque, lui, n'est PAS
// couvert par cette transaction (ce n'est pas du SQL), d'où le nettoyage
// manuel du dossier temporaire dans afterAll.
describe("Documents — upload chiffré, statut calculé, accès journalisé (intégration Postgres réelle)", () => {
  const storageDirTest = path.join(os.tmpdir(), `appli-immo-test-documents-${randomUUID()}`);
  process.env["DOCUMENTS_STORAGE_DIR"] = storageDirTest;

  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let scisService: ScisService;
  let immeublesService: ImmeublesService;
  let appartementsService: AppartementsService;
  let documentsService: DocumentsService;
  let requestContextService: RequestContextService;
  let db: Database;
  let userId: string;
  let appartementId: string;

  function fichierTest(contenu: string, nom = "bail-signe.pdf"): Express.Multer.File {
    return {
      originalname: nom,
      mimetype: "application/pdf",
      buffer: Buffer.from(contenu, "utf8"),
      size: Buffer.byteLength(contenu, "utf8")
    } as Express.Multer.File;
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
        ImmeublesModule,
        AppartementsModule,
        DocumentsModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    immeublesService = moduleRef.get(ImmeublesService);
    appartementsService = moduleRef.get(AppartementsService);
    documentsService = moduleRef.get(DocumentsService);
    requestContextService = moduleRef.get(RequestContextService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Documents Intégration" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }

    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `documents-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Documents",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    userId = user.id;

    const sci = await scisService.create(userId, { nom: "SCI Documents Test", regimeFiscal: "IR", adresse: "1 rue de Test", codePostal: "75001", ville: "Paris" });
    const immeuble = await immeublesService.create({
      sciId: sci.id,
      nom: "Immeuble Documents Test",
      adresse: "1 rue des Documents",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartement = await appartementsService.create({
      immeubleId: immeuble.id,
      numero: "1",
      type: "T2",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel",
      loyerReference: "850.00"
    });
    appartementId = appartement.id;
  });

  afterEach(async () => {
    await moduleRef.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
    await rm(storageDirTest, { recursive: true, force: true });
  });

  it("upload : la ligne documents est créée, chiffrée sur disque, et se déchiffre à l'identique", async () => {
    const contenuOriginal = "%PDF-1.4 contenu factice de bail pour test d'intégration";
    const document = await documentsService.upload(
      { entiteType: "appartement", entiteId: appartementId, categorie: "bail" },
      fichierTest(contenuOriginal)
    );

    expect(document.entiteType).toBe("appartement");
    expect(document.entiteId).toBe(appartementId);
    expect(document.categorie).toBe("bail");
    expect(document.nomFichier).toBe("bail-signe.pdf");
    expect(document.mimeType).toBe("application/pdf");
    expect(document.tailleOctets).toBe(Buffer.byteLength(contenuOriginal, "utf8"));
    expect(document.statut).toBe("valide");

    // Le contenu sur disque doit être chiffré, jamais lisible en clair.
    const fichiersSurDisque = await readdir(storageDirTest);
    expect(fichiersSurDisque).toHaveLength(1);
    const brutSurDisque = await readFile(path.join(storageDirTest, fichiersSurDisque[0]!));
    expect(brutSurDisque.toString("utf8")).not.toContain(contenuOriginal);

    const { contenu } = await documentsService.telecharger(document.id);
    expect(contenu.toString("utf8")).toBe(contenuOriginal);
  });

  it("upload : rejette un entiteId qui ne correspond à aucune entité existante", async () => {
    await expect(
      documentsService.upload(
        { entiteType: "appartement", entiteId: randomUUID(), categorie: "bail" },
        fichierTest("peu importe")
      )
    ).rejects.toThrow();
  });

  it("statut expire : calculé à la lecture, sans jamais réécrire la colonne stockée (Module 6 s'en chargera)", async () => {
    const document = await documentsService.upload(
      { entiteType: "appartement", entiteId: appartementId, categorie: "diagnostic", dateExpiration: "2020-01-01" },
      fichierTest("diagnostic expiré")
    );

    // Vu par l'API : expiré.
    const relu = await documentsService.findById(document.id);
    expect(relu?.statut).toBe("expire");
    const parListe = await documentsService.findAll({ entiteId: appartementId });
    expect(parListe.find((d) => d.id === document.id)?.statut).toBe("expire");

    // Vu directement en base (colonne brute, hors calcul applicatif) :
    // toujours 'valide' — aucune écriture de 'expire' avant le job du
    // Module 6 (voir docs/data-dictionary.md, section documents).
    const [ligneBrute] = await db.select().from(documents).where(eq(documents.id, document.id)).limit(1);
    expect(ligneBrute?.statut).toBe("valide");
  });

  it("statut valide : document sans date d'expiration ou expirant dans le futur", async () => {
    const sansExpiration = await documentsService.upload(
      { entiteType: "appartement", entiteId: appartementId, categorie: "photo" },
      fichierTest("photo")
    );
    expect(sansExpiration.statut).toBe("valide");

    const futur = await documentsService.upload(
      {
        entiteType: "appartement",
        entiteId: appartementId,
        categorie: "assurance",
        dateExpiration: "2099-01-01"
      },
      fichierTest("assurance")
    );
    expect(futur.statut).toBe("valide");
  });

  it("archiver() persiste réellement statut='archive' et prime sur une date d'expiration dépassée", async () => {
    const document = await documentsService.upload(
      { entiteType: "appartement", entiteId: appartementId, categorie: "diagnostic", dateExpiration: "2020-01-01" },
      fichierTest("diagnostic à archiver")
    );

    const archive = await documentsService.archiver(document.id);
    expect(archive.statut).toBe("archive");
    expect(archive.archivedAt).not.toBeNull();

    const sansArchives = await documentsService.findAll({ entiteId: appartementId });
    expect(sansArchives.find((d) => d.id === document.id)).toBeUndefined();

    const avecArchives = await documentsService.findAll({ entiteId: appartementId, avecArchives: true });
    expect(avecArchives.find((d) => d.id === document.id)?.statut).toBe("archive");
  });

  it("telecharger() journalise un accès à un document sensible (journal_audit)", async () => {
    const document = await documentsService.upload(
      { entiteType: "appartement", entiteId: appartementId, categorie: "piece_identite" },
      fichierTest("pièce d'identité")
    );

    await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      documentsService.telecharger(document.id)
    );

    const lignesAudit = await db
      .select()
      .from(journalAudit)
      .where(eq(journalAudit.entiteId, document.id));
    expect(lignesAudit).toHaveLength(1);
    expect(lignesAudit[0]?.entiteType).toBe("document_sensible");
    expect(lignesAudit[0]?.action).toBe("acces");
    expect(lignesAudit[0]?.utilisateurId).toBe(userId);
  });

  it("findAll : filtre par catégorie et par recherche sur le nom de fichier", async () => {
    await documentsService.upload(
      { entiteType: "appartement", entiteId: appartementId, categorie: "bail" },
      fichierTest("bail", "bail-2026.pdf")
    );
    await documentsService.upload(
      { entiteType: "appartement", entiteId: appartementId, categorie: "dpe" },
      fichierTest("dpe", "diagnostic-energie.pdf")
    );

    const bauxSeulement = await documentsService.findAll({ entiteId: appartementId, categorie: "bail" });
    expect(bauxSeulement).toHaveLength(1);
    expect(bauxSeulement[0]?.nomFichier).toBe("bail-2026.pdf");

    const parRecherche = await documentsService.findAll({ entiteId: appartementId, recherche: "energie" });
    expect(parRecherche).toHaveLength(1);
    expect(parRecherche[0]?.nomFichier).toBe("diagnostic-energie.pdf");
  });
});
