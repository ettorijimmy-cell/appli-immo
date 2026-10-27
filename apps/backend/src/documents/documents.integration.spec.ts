import { randomUUID } from "crypto";
import { readFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { BadRequestException, ConflictException } from "@nestjs/common";
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
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CandidatsModule } from "../candidats/candidats.module";
import { CandidatsService } from "../candidats/candidats.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
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
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let documentsService: DocumentsService;
  let candidatsService: CandidatsService;
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
        BienModule,
        AppartementsModule,
        CandidatsModule,
        DocumentsModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    documentsService = moduleRef.get(DocumentsService);
    candidatsService = moduleRef.get(CandidatsService);
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
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Documents Test",
      adresse: "1 rue des Documents",
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
      loyerReference: "850.00"
    });
    appartementId = appartement.id;
  });

  afterEach(async () => {
    await moduleRef?.close();
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

    // chemin_stockage est une clé de stockage interne (disque ou bucket) :
    // jamais renvoyée par versDto (projection explicite, pas un spread).
    expect(document).not.toHaveProperty("cheminStockage");

    // Chemin organisé par entité : documents/<entiteType>/<entiteId>/<documentId>.enc
    // (voir construireCheminStockage) — jamais le nom de fichier original.
    // Vérifié directement en base, puisque la réponse API ne l'expose plus.
    const [ligneBrute] = await db.select().from(documents).where(eq(documents.id, document.id)).limit(1);
    expect(ligneBrute?.cheminStockage).toBe(`documents/appartement/${appartementId}/${document.id}.enc`);

    // Le contenu sur disque doit être chiffré, jamais lisible en clair.
    const brutSurDisque = await readFile(path.join(storageDirTest, ligneBrute!.cheminStockage));
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

  it("upload : refuse (400) la catégorie 'signature' — réservée à EtatsDesLieuxSignatureService", async () => {
    await expect(
      documentsService.upload(
        { entiteType: "appartement", entiteId: appartementId, categorie: "signature" },
        fichierTest("peu importe")
      )
    ).rejects.toThrow(BadRequestException);
  });

  it("update() : refuse (400) de reclasser un document existant en catégorie 'signature'", async () => {
    const document = await documentsService.upload(
      { entiteType: "appartement", entiteId: appartementId, categorie: "bail" },
      fichierTest("peu importe")
    );
    await expect(documentsService.update(document.id, { categorie: "signature" })).rejects.toThrow(
      BadRequestException
    );
  });

  it("remplacerDocument() : refuse (400) de créer une nouvelle version en catégorie 'signature'", async () => {
    const document = await documentsService.upload(
      { entiteType: "appartement", entiteId: appartementId, categorie: "bail" },
      fichierTest("peu importe")
    );
    await expect(
      documentsService.remplacerDocument(document.id, { categorie: "signature" }, fichierTest("v2"))
    ).rejects.toThrow(BadRequestException);
  });

  // Chantier PDF étape 4 (2026-10-27) : .docx figé et PDF de l'état des
  // lieux — même principe que "signature" ci-dessus, mais ces deux
  // catégories n'ont pas encore de service de génération dédié à ce stade
  // (prochain commit) : les lignes de test sont insérées directement en
  // base (comme le fera ce futur service, en dehors de cette route
  // générique), jamais via documentsService.upload().
  describe("catégories réservées 'etat_des_lieux_docx'/'etat_des_lieux_pdf' (chantier PDF étape 4)", () => {
    it.each(["etat_des_lieux_docx", "etat_des_lieux_pdf"] as const)(
      "upload() : refuse (400) la catégorie '%s' — réservée au service de génération PDF",
      async (categorie) => {
        await expect(
          documentsService.upload({ entiteType: "appartement", entiteId: appartementId, categorie }, fichierTest("peu importe"))
        ).rejects.toThrow(BadRequestException);
      }
    );

    it.each(["etat_des_lieux_docx", "etat_des_lieux_pdf"] as const)(
      "update()/remplacerDocument() : refusent (400) de reclasser un document existant en catégorie '%s'",
      async (categorie) => {
        const document = await documentsService.upload(
          { entiteType: "appartement", entiteId: appartementId, categorie: "bail" },
          fichierTest("peu importe")
        );
        await expect(documentsService.update(document.id, { categorie })).rejects.toThrow(BadRequestException);
        await expect(documentsService.remplacerDocument(document.id, { categorie }, fichierTest("v2"))).rejects.toThrow(
          BadRequestException
        );
      }
    );

    // Ligne insérée directement en base (categorie déjà réservée) : simule
    // ce que fera le futur service de génération, pour tester le verrou
    // côté lecture/écriture existante (update/archiver), pas seulement la
    // création.
    async function creerLigneFigee(categorie: "etat_des_lieux_docx" | "etat_des_lieux_pdf", phase: "entree" | "sortie") {
      const [ligne] = await db
        .insert(documents)
        .values({
          entiteType: "appartement",
          entiteId: appartementId,
          categorie,
          nomFichier: `${categorie}.bin`,
          mimeType: "application/octet-stream",
          tailleOctets: 1,
          cheminStockage: `documents/appartement/${appartementId}/${randomUUID()}.enc`,
          etatDesLieuxPhase: phase,
          estEtatDesLieuxFige: true
        })
        .returning();
      if (!ligne) {
        throw new Error("Échec de l'insertion de la ligne figée de test");
      }
      return ligne;
    }

    it.each(["etat_des_lieux_docx", "etat_des_lieux_pdf"] as const)(
      "update() : refuse (409) de modifier un document existant déjà en catégorie '%s'",
      async (categorie) => {
        const ligne = await creerLigneFigee(categorie, "entree");
        await expect(documentsService.update(ligne.id, { dateExpiration: "2030-01-01" })).rejects.toThrow(
          ConflictException
        );
      }
    );

    it.each(["etat_des_lieux_docx", "etat_des_lieux_pdf"] as const)(
      "archiver() : refuse (409) d'archiver un document existant déjà en catégorie '%s'",
      async (categorie) => {
        const ligne = await creerLigneFigee(categorie, "sortie");
        await expect(documentsService.archiver(ligne.id)).rejects.toThrow(ConflictException);
      }
    );

    // Index unique partiel documents_etat_des_lieux_fige_unique
    // (packages/db/src/schema/documents.ts) : au plus une ligne par
    // (entite_id, categorie, etat_des_lieux_phase) quand
    // est_etat_des_lieux_fige=true. Vérifié directement contre Postgres
    // (insertion brute), pas via un service applicatif — c'est la base qui
    // doit trancher la course entre génération immédiate/relance/bouton,
    // jamais un SELECT préalable (voir le commentaire de l'index).
    it("index unique partiel : une deuxième ligne figée pour le même (entité, catégorie, phase) est rejetée par Postgres", async () => {
      await creerLigneFigee("etat_des_lieux_docx", "entree");
      await expect(creerLigneFigee("etat_des_lieux_docx", "entree")).rejects.toThrow(/duplicate key value|unique constraint/i);
    });

    it("index unique partiel : une ligne de phase différente pour la même entité/catégorie est acceptée", async () => {
      await creerLigneFigee("etat_des_lieux_docx", "entree");
      await expect(creerLigneFigee("etat_des_lieux_docx", "sortie")).resolves.toBeTruthy();
    });

    it("index unique partiel : une ligne de catégorie différente pour la même entité/phase est acceptée", async () => {
      await creerLigneFigee("etat_des_lieux_docx", "entree");
      await expect(creerLigneFigee("etat_des_lieux_pdf", "entree")).resolves.toBeTruthy();
    });

    // CHECK documents_est_etat_des_lieux_fige_coherent
    // (packages/db/src/schema/documents.ts) : coûte-que-coûte cohérent
    // même en cas de bug applicatif futur contournant DocumentsService —
    // les deux sens de l'incohérence sont testés.
    it("CHECK : rejette une catégorie réservée (docx/pdf) avec est_etat_des_lieux_fige=false", async () => {
      await expect(
        db.insert(documents).values({
          entiteType: "appartement",
          entiteId: appartementId,
          categorie: "etat_des_lieux_docx",
          nomFichier: "test.bin",
          mimeType: "application/octet-stream",
          tailleOctets: 1,
          cheminStockage: `documents/appartement/${appartementId}/${randomUUID()}.enc`,
          etatDesLieuxPhase: "entree",
          estEtatDesLieuxFige: false
        })
      ).rejects.toThrow(/violates check constraint|documents_est_etat_des_lieux_fige_coherent/i);
    });

    it("CHECK : rejette une catégorie non réservée (ex. 'bail') avec est_etat_des_lieux_fige=true", async () => {
      await expect(
        db.insert(documents).values({
          entiteType: "appartement",
          entiteId: appartementId,
          categorie: "bail",
          nomFichier: "test.bin",
          mimeType: "application/octet-stream",
          tailleOctets: 1,
          cheminStockage: `documents/appartement/${appartementId}/${randomUUID()}.enc`,
          estEtatDesLieuxFige: true
        })
      ).rejects.toThrow(/violates check constraint|documents_est_etat_des_lieux_fige_coherent/i);
    });
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

  it("remplacerDocument() : chaîne la nouvelle version, archive l'ancienne, sans jamais la supprimer physiquement", async () => {
    const contenuOriginal = "diagnostic DPE 2025";
    const ancien = await documentsService.upload(
      { entiteType: "appartement", entiteId: appartementId, categorie: "dpe", dateExpiration: "2026-06-01" },
      fichierTest(contenuOriginal, "dpe-2025.pdf")
    );

    const contenuNouveau = "diagnostic DPE 2026, renouvelé";
    const nouveau = await documentsService.remplacerDocument(
      ancien.id,
      { categorie: "dpe", dateExpiration: "2027-06-01" },
      fichierTest(contenuNouveau, "dpe-2026.pdf")
    );

    expect(nouveau.documentPrecedentId).toBe(ancien.id);
    expect(nouveau.statut).toBe("valide");
    expect(nouveau.entiteType).toBe("appartement");
    expect(nouveau.entiteId).toBe(appartementId);
    expect(nouveau.nomFichier).toBe("dpe-2026.pdf");

    // L'ancienne version est archivée automatiquement (même mécanisme que
    // archiver()), jamais supprimée physiquement — son contenu reste
    // accessible.
    const ancienRelu = await documentsService.findById(ancien.id);
    expect(ancienRelu?.statut).toBe("archive");
    expect(ancienRelu?.archivedAt).not.toBeNull();
    const { contenu: contenuAncienToujoursLisible } = await documentsService.telecharger(ancien.id);
    expect(contenuAncienToujoursLisible.toString("utf8")).toBe(contenuOriginal);

    // Une seule version 'valide' dans la chaîne : l'ancienne n'apparaît
    // plus dans la liste par défaut, seule la nouvelle y figure.
    const sansArchives = await documentsService.findAll({ entiteId: appartementId });
    expect(sansArchives.find((d) => d.id === ancien.id)).toBeUndefined();
    expect(sansArchives.find((d) => d.id === nouveau.id)?.statut).toBe("valide");
  });

  it("remplacerDocument() : rejette le remplacement d'une version déjà archivée (via un remplacement précédent)", async () => {
    const original = await documentsService.upload(
      { entiteType: "appartement", entiteId: appartementId, categorie: "dpe" },
      fichierTest("v1")
    );
    await documentsService.remplacerDocument(original.id, { categorie: "dpe" }, fichierTest("v2"));

    await expect(
      documentsService.remplacerDocument(original.id, { categorie: "dpe" }, fichierTest("v3"))
    ).rejects.toThrow(/version courante/i);
  });

  it("remplacerDocument() : rejette le remplacement d'une version archivée manuellement, mais upload() reste possible sans lien de version", async () => {
    const document = await documentsService.upload(
      { entiteType: "appartement", entiteId: appartementId, categorie: "assurance" },
      fichierTest("assurance archivée manuellement")
    );
    await documentsService.archiver(document.id);

    await expect(
      documentsService.remplacerDocument(document.id, { categorie: "assurance" }, fichierTest("tentative"))
    ).rejects.toThrow(/version courante/i);

    // Un nouvel upload indépendant, sans document_precedent_id, reste
    // possible pour la même entité — l'archivage manuel ne bloque jamais
    // upload().
    const nouveauSansLien = await documentsService.upload(
      { entiteType: "appartement", entiteId: appartementId, categorie: "assurance" },
      fichierTest("nouvelle assurance")
    );
    expect(nouveauSansLien.documentPrecedentId).toBeNull();
    expect(nouveauSansLien.statut).toBe("valide");
  });

  it("remplacerDocument() : rejette un documentPrecedentId inexistant", async () => {
    await expect(
      documentsService.remplacerDocument(randomUUID(), { categorie: "dpe" }, fichierTest("peu importe"))
    ).rejects.toThrow();
  });

  it("remplacerDocument() : garde etatDesLieuxPieceType/Numero valables uniquement pour entiteType 'etat_des_lieux', comme upload()", async () => {
    const ancien = await documentsService.upload(
      { entiteType: "appartement", entiteId: appartementId, categorie: "photo" },
      fichierTest("photo v1")
    );

    await expect(
      documentsService.remplacerDocument(
        ancien.id,
        { categorie: "photo", etatDesLieuxPieceType: "cuisine" },
        fichierTest("photo v2")
      )
    ).rejects.toThrow(/etat_des_lieux/);
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

  // Extension checklist candidat (2026-09-15) : candidatRole distingue un
  // document du candidat de celui de son garant (le garant n'est pas une
  // entité réelle à ce stade, voir packages/db/src/schema/documents.ts).
  describe("candidatRole", () => {
    it("upload : rejette entiteType='candidat' sans candidatRole", async () => {
      const candidatTest = await candidatsService.create(userId, { nom: "Candidat", prenom: "Sans Role" });
      await expect(
        documentsService.upload(
          { entiteType: "candidat", entiteId: candidatTest.id, categorie: "piece_identite" },
          fichierTest("pièce d'identité")
        )
      ).rejects.toThrow();
    });

    it("upload : rejette candidatRole pour un entiteType différent de 'candidat'", async () => {
      await expect(
        documentsService.upload(
          { entiteType: "appartement", entiteId: appartementId, categorie: "bail", candidatRole: "candidat" },
          fichierTest("bail")
        )
      ).rejects.toThrow();
    });

    it("upload : accepte et distingue les documents du candidat et de son garant", async () => {
      const candidatTest = await candidatsService.create(userId, { nom: "Candidat", prenom: "Avec Garant" });

      const documentCandidat = await documentsService.upload(
        { entiteType: "candidat", entiteId: candidatTest.id, categorie: "piece_identite", candidatRole: "candidat" },
        fichierTest("cni-candidat.pdf")
      );
      const documentGarant = await documentsService.upload(
        { entiteType: "candidat", entiteId: candidatTest.id, categorie: "piece_identite", candidatRole: "garant" },
        fichierTest("cni-garant.pdf")
      );

      expect(documentCandidat.candidatRole).toBe("candidat");
      expect(documentGarant.candidatRole).toBe("garant");

      const documentsDuCandidat = await documentsService.findAll({
        entiteType: "candidat",
        entiteId: candidatTest.id,
        candidatRole: "candidat"
      });
      expect(documentsDuCandidat.map((d) => d.id)).toEqual([documentCandidat.id]);

      const documentsDuGarant = await documentsService.findAll({
        entiteType: "candidat",
        entiteId: candidatTest.id,
        candidatRole: "garant"
      });
      expect(documentsDuGarant.map((d) => d.id)).toEqual([documentGarant.id]);
    });

    it("upload : accepte plusieurs fiche_de_paie pour le même candidat (aucune contrainte d'unicité)", async () => {
      const candidatTest = await candidatsService.create(userId, { nom: "Candidat", prenom: "Trois Fiches" });
      await documentsService.upload(
        { entiteType: "candidat", entiteId: candidatTest.id, categorie: "fiche_de_paie", candidatRole: "candidat" },
        fichierTest("fiche-1.pdf")
      );
      await documentsService.upload(
        { entiteType: "candidat", entiteId: candidatTest.id, categorie: "fiche_de_paie", candidatRole: "candidat" },
        fichierTest("fiche-2.pdf")
      );
      await documentsService.upload(
        { entiteType: "candidat", entiteId: candidatTest.id, categorie: "fiche_de_paie", candidatRole: "candidat" },
        fichierTest("fiche-3.pdf")
      );

      const fiches = await documentsService.findAll({
        entiteType: "candidat",
        entiteId: candidatTest.id,
        categorie: "fiche_de_paie"
      });
      expect(fiches).toHaveLength(3);
    });
  });
});
