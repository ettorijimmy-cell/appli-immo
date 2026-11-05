import { randomUUID } from "crypto";
import { rm } from "fs/promises";
import os from "os";
import path from "path";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, etatsDesLieux, organisations, utilisateurs, type Database } from "db";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { BailLocatairesModule } from "../bail-locataires/bail-locataires.module";
import { BailLocatairesService } from "../bail-locataires/bail-locataires.service";
import { BauxModule } from "../baux/baux.module";
import { BauxService } from "../baux/baux.service";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { DocumentsModule } from "../documents/documents.module";
import { DocumentsService } from "../documents/documents.service";
import { EtatsDesLieuxSignatureModule } from "../etats-des-lieux-signature/etats-des-lieux-signature.module";
import { EtatsDesLieuxSignatureService } from "../etats-des-lieux-signature/etats-des-lieux-signature.service";
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { EtatsDesLieuxModule } from "./etats-des-lieux.module";
import { EtatsDesLieuxService } from "./etats-des-lieux.service";

// Même motif que verrou-signature-etat-des-lieux.integration.spec.ts : une
// signature lance la chaîne docx/PDF d'arrière-plan sur la connexion
// unique du test (environ 5,9 s seul pour le test qui signe l'entrée).
vi.setConfig({ testTimeout: 20000 });

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const PHOTO = {
  originalname: "piece.jpg",
  mimetype: "image/jpeg",
  buffer: Buffer.from("contenu factice"),
  size: 16
} as Express.Multer.File;

// Abandon d'un brouillon d'état des lieux (2026-11-05) : archivage avec
// motif, refusé dès qu'une phase est signée ; un bail libéré accepte un
// nouvel état des lieux ; un brouillon abandonné reste lisible mais
// n'accepte plus aucune écriture.
describe("État des lieux — abandon d'un brouillon (intégration Postgres réelle)", () => {
  const storageDirTest = path.join(os.tmpdir(), `appli-immo-test-abandon-${randomUUID()}`);
  process.env["DOCUMENTS_STORAGE_DIR"] = storageDirTest;

  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let locatairesService: LocatairesService;
  let bauxService: BauxService;
  let bailLocatairesService: BailLocatairesService;
  let etatsDesLieuxService: EtatsDesLieuxService;
  let documentsService: DocumentsService;
  let signatureService: EtatsDesLieuxSignatureService;
  let requestContextService: RequestContextService;
  let organisationId: string;
  let userId: string;

  async function creerOrganisationEtUtilisateur(libelle: string): Promise<{ organisationId: string; userId: string }> {
    const [organisation] = await db.insert(organisations).values({ type: "particulier", nom: libelle }).returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `abandon-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Abandon",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    return { organisationId: organisation.id, userId: user.id };
  }

  function avecContexte<T>(fn: () => T, contexte = { utilisateurId: userId, organisationId }): T {
    return requestContextService.executerAvecContexte(contexte, fn);
  }

  async function creerDossier() {
    const sci = await scisService.create(userId, {
      nom: "SCI Abandon Test",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Abandon Test",
      adresse: "1 rue de l'Abandon",
      codePostal: "75001",
      ville: "Lyon",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: "1",
      type: "T2",
      nombrePiecesPrincipales: 2,
      modeChauffage: "individuel",
      modeEauChaude: "individuel",
      loyerReference: "700.00"
    });
    await appartementsService.update(appartement.id, { nombreChambres: 1, nombreSallesDeBain: 1, nombreWc: 1 });
    const titulaire = await locatairesService.create(userId, { nom: "Martin", prenom: "Claire" });
    const bail = await bauxService.create({
      appartementId: appartement.id,
      typeBail: "vide",
      dateDebut: "2026-08-01",
      loyerMensuel: "650.00",
      depotGarantie: "650.00",
      provisionsCharges: "30.00",
      jourEcheance: 5
    });
    await bailLocatairesService.create({ bailId: bail.id, locataireId: titulaire.id, role: "titulaire" });
    const etatDesLieux = await avecContexte(() => etatsDesLieuxService.create({ bailId: bail.id }));
    return { bailId: bail.id, etatDesLieuxId: etatDesLieux.id, titulaireId: titulaire.id };
  }

  function dtoSignature(locataireId: string) {
    return {
      bailleur: { nomAffiche: "Bailleur Test", luEtApprouve: true, imagePng: PNG_1X1_BASE64 },
      locataires: [{ locataireId, luEtApprouve: true, imagePng: PNG_1X1_BASE64 }]
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
        LocatairesModule,
        BauxModule,
        BailLocatairesModule,
        DocumentsModule,
        EtatsDesLieuxModule,
        EtatsDesLieuxSignatureModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    locatairesService = moduleRef.get(LocatairesService);
    bauxService = moduleRef.get(BauxService);
    bailLocatairesService = moduleRef.get(BailLocatairesService);
    etatsDesLieuxService = moduleRef.get(EtatsDesLieuxService);
    documentsService = moduleRef.get(DocumentsService);
    signatureService = moduleRef.get(EtatsDesLieuxSignatureService);
    requestContextService = moduleRef.get(RequestContextService);

    ({ organisationId, userId } = await creerOrganisationEtUtilisateur("Organisation Abandon Test"));
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
    await rm(storageDirTest, { recursive: true, force: true });
  });

  it("abandonne un brouillon non signé : archivage avec motif nettoyé et auteur, le bail est libéré et accepte un nouvel état des lieux", async () => {
    const { bailId, etatDesLieuxId } = await creerDossier();

    const abandonne = await avecContexte(() =>
      etatsDesLieuxService.abandonner(etatDesLieuxId, { motif: "  Créé par erreur  " })
    );
    expect(abandonne.archivedAt).toBeInstanceOf(Date);
    expect(abandonne.motifAbandon).toBe("Créé par erreur");
    expect(abandonne.updatedBy).toBe(userId);

    expect(await avecContexte(() => etatsDesLieuxService.findByBailId(bailId))).toBeNull();

    const nouveau = await avecContexte(() => etatsDesLieuxService.create({ bailId }));
    expect(nouveau.id).not.toBe(etatDesLieuxId);
    expect(nouveau.archivedAt).toBeNull();
    expect((await avecContexte(() => etatsDesLieuxService.findByBailId(bailId)))?.id).toBe(nouveau.id);

    const abandonnes = await avecContexte(() => etatsDesLieuxService.listerAbandonnes(bailId));
    expect(abandonnes.map((ligne) => [ligne.id, ligne.motifAbandon])).toEqual([[etatDesLieuxId, "Créé par erreur"]]);
  });

  it("refuse un motif vide ou fait d'espaces, sans rien archiver", async () => {
    const { bailId, etatDesLieuxId } = await creerDossier();
    await expect(
      avecContexte(() => etatsDesLieuxService.abandonner(etatDesLieuxId, { motif: "   " }))
    ).rejects.toThrow(BadRequestException);
    expect((await avecContexte(() => etatsDesLieuxService.findByBailId(bailId)))?.id).toBe(etatDesLieuxId);
  });

  it("refuse l'abandon d'un état des lieux dont l'entrée est signée", async () => {
    const { etatDesLieuxId, titulaireId } = await creerDossier();
    await avecContexte(() => signatureService.signerEntree(etatDesLieuxId, dtoSignature(titulaireId)));

    await expect(
      avecContexte(() => etatsDesLieuxService.abandonner(etatDesLieuxId, { motif: "Erreur" }))
    ).rejects.toThrow(/signé, ce n'est plus un brouillon/);
    const [ligne] = await db.select().from(etatsDesLieux).where(eq(etatsDesLieux.id, etatDesLieuxId));
    expect(ligne?.archivedAt).toBeNull();
    expect(ligne?.motifAbandon).toBeNull();
  });

  it("refuse un second abandon du même brouillon", async () => {
    const { etatDesLieuxId } = await creerDossier();
    await avecContexte(() => etatsDesLieuxService.abandonner(etatDesLieuxId, { motif: "Erreur" }));
    await expect(
      avecContexte(() => etatsDesLieuxService.abandonner(etatDesLieuxId, { motif: "Encore" }))
    ).rejects.toThrow(/déjà abandonné/);
  });

  it("un brouillon abandonné reste lisible mais refuse toute écriture : pièces, en-tête, listes, photo, signature", async () => {
    const { etatDesLieuxId, titulaireId } = await creerDossier();
    await avecContexte(() =>
      etatsDesLieuxService.submitPieceEntree(etatDesLieuxId, { mur: { description: "RAS", etatEntree: "B" } })
    );
    await avecContexte(() => etatsDesLieuxService.abandonner(etatDesLieuxId, { motif: "Erreur" }));

    const relu = await avecContexte(() => etatsDesLieuxService.findById(etatDesLieuxId));
    expect(relu.entree?.murDescription).toBe("RAS");
    expect(relu.motifAbandon).toBe("Erreur");

    const refus = /abandonné/;
    await expect(
      avecContexte(() => etatsDesLieuxService.submitPieceEntree(etatDesLieuxId, { mur: { etatEntree: "M" } }))
    ).rejects.toThrow(refus);
    await expect(
      avecContexte(() => etatsDesLieuxService.updateHeader(etatDesLieuxId, { dateEntree: "2026-09-01" }))
    ).rejects.toThrow(refus);
    await expect(
      avecContexte(() =>
        etatsDesLieuxService.submitCles(etatDesLieuxId, { lignes: [{ typeCle: "porte_entree", nombreEntree: 2 }] })
      )
    ).rejects.toThrow(refus);
    await expect(
      avecContexte(() =>
        documentsService.upload({ entiteType: "etat_des_lieux", entiteId: etatDesLieuxId, categorie: "photo" }, PHOTO)
      )
    ).rejects.toThrow(refus);
    await expect(
      avecContexte(() => signatureService.signerEntree(etatDesLieuxId, dtoSignature(titulaireId)))
    ).rejects.toThrow(ConflictException);
  });

  it("autre organisation : abandon introuvable et liste des abandonnés vide", async () => {
    const { bailId, etatDesLieuxId } = await creerDossier();
    await avecContexte(() => etatsDesLieuxService.abandonner(etatDesLieuxId, { motif: "Erreur" }));
    const autre = await creerOrganisationEtUtilisateur("Organisation Étrangère");
    const contexteEtranger = { utilisateurId: autre.userId, organisationId: autre.organisationId };

    expect(await avecContexte(() => etatsDesLieuxService.listerAbandonnes(bailId), contexteEtranger)).toEqual([]);
    const { etatDesLieuxId: actif } = await creerDossier();
    await expect(
      avecContexte(() => etatsDesLieuxService.abandonner(actif, { motif: "Intrusion" }), contexteEtranger)
    ).rejects.toThrow(NotFoundException);
  });

  describe("garanties portées par la base", () => {
    // Chaque écriture refusée passe dans un point de sauvegarde (transaction
    // imbriquée) : une erreur Postgres annulerait sinon toute la transaction
    // du test, et les requêtes suivantes échoueraient pour cette raison.
    function dansUnSavepoint(ecriture: (tx: Database) => Promise<unknown>): Promise<unknown> {
      return db.transaction((tx) => ecriture(tx as unknown as Database));
    }

    it("refuse un second état des lieux actif pour le même bail (index unique partiel), l'accepte une fois le premier archivé", async () => {
      const { bailId, etatDesLieuxId } = await creerDossier();
      await expect(dansUnSavepoint((tx) => tx.insert(etatsDesLieux).values({ bailId }))).rejects.toThrow(
        /etats_des_lieux_bail_id_actif_unique|duplicate key/
      );
      await db
        .update(etatsDesLieux)
        .set({ archivedAt: new Date(), motifAbandon: "Erreur" })
        .where(eq(etatsDesLieux.id, etatDesLieuxId));
      await expect(db.insert(etatsDesLieux).values({ bailId }).returning()).resolves.toHaveLength(1);
    });

    it("refuse un archivage sans motif, un motif blanc et un motif sans archivage (CHECK)", async () => {
      const { etatDesLieuxId } = await creerDossier();
      const violation = /etats_des_lieux_motif_abandon_coherent|check constraint/;
      for (const valeurs of [
        { archivedAt: new Date() },
        { archivedAt: new Date(), motifAbandon: "  " },
        { motifAbandon: "Erreur" }
      ]) {
        await expect(
          dansUnSavepoint((tx) => tx.update(etatsDesLieux).set(valeurs).where(eq(etatsDesLieux.id, etatDesLieuxId)))
        ).rejects.toThrow(violation);
      }
      const [ligne] = await db
        .select({ archive: sql<boolean>`${etatsDesLieux.archivedAt} IS NOT NULL` })
        .from(etatsDesLieux)
        .where(eq(etatsDesLieux.id, etatDesLieuxId));
      expect(ligne?.archive).toBe(false);
    });
  });
});
