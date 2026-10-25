import { randomUUID } from "crypto";
import { rm } from "fs/promises";
import os from "os";
import path from "path";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, utilisateurs, type Database } from "db";
import PizZip from "pizzip";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
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
import { EtatsDesLieuxSignatureModule } from "../etats-des-lieux-signature/etats-des-lieux-signature.module";
import { EtatsDesLieuxSignatureService } from "../etats-des-lieux-signature/etats-des-lieux-signature.service";
import { EtatsDesLieuxModule } from "../etats-des-lieux/etats-des-lieux.module";
import { EtatsDesLieuxService } from "../etats-des-lieux/etats-des-lieux.service";
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { EtatDesLieuxDocumentDocxModule } from "./etat-des-lieux-document-docx.module";
import { EtatDesLieuxDocumentDocxService } from "./etat-des-lieux-document-docx.service";

const FIXTURE_TEMPLATE = path.join(__dirname, "__fixtures__", "modele-etat-des-lieux-test.docx");
process.env["ETAT_DES_LIEUX_DOCUMENT_DOCX_TEMPLATE_PATH"] = FIXTURE_TEMPLATE;

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function texteDuDocx(buffer: Buffer): string {
  const zip = new PizZip(buffer);
  const documentXml = zip.files["word/document.xml"];
  if (!documentXml) {
    throw new Error("word/document.xml introuvable dans le .docx généré");
  }
  const xml = documentXml.asText();
  return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("|");
}

function balisesResiduelles(buffer: Buffer): string[] {
  const texte = texteDuDocx(buffer).replace(/\|/g, "");
  return [...new Set([...texte.matchAll(/\{[^}]*\}/g)].map((m) => m[0]))];
}

describe("Génération docx — bloc signatures (Entrée/Sortie, intégration Postgres réelle)", () => {
  const storageDirTest = path.join(os.tmpdir(), `appli-immo-test-docx-signatures-${randomUUID()}`);
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
  let etatsDesLieuxSignatureService: EtatsDesLieuxSignatureService;
  let etatDesLieuxDocumentDocxService: EtatDesLieuxDocumentDocxService;
  let requestContextService: RequestContextService;
  let organisationId: string;
  let userId: string;

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
        EtatsDesLieuxSignatureModule,
        EtatDesLieuxDocumentDocxModule
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
    etatsDesLieuxSignatureService = moduleRef.get(EtatsDesLieuxSignatureService);
    etatDesLieuxDocumentDocxService = moduleRef.get(EtatDesLieuxDocumentDocxService);
    requestContextService = moduleRef.get(RequestContextService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Docx Signatures Test" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `docx-signatures-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Docx",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    organisationId = organisation.id;
    userId = user.id;
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
    await rm(storageDirTest, { recursive: true, force: true });
  });

  function avecContexte<T>(fn: () => T): T {
    return requestContextService.executerAvecContexte({ utilisateurId: userId, organisationId }, fn);
  }

  // `nombreColocataires` pilote 1 ou 2 locataires (titulaire + colocataires).
  async function creerDossier(nombreColocataires: number) {
    const sci = await scisService.create(userId, {
      nom: "SCI Docx Signatures Test",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Docx Signatures Test",
      adresse: "1 rue des Signatures",
      codePostal: "75001",
      ville: "Lyon",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: "1",
      type: "T2",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    await appartementsService.update(appartement.id, { nombreChambres: 1, nombreSallesDeBain: 1, nombreWc: 1 });
    const titulaire = await locatairesService.create(userId, { nom: "Dupont", prenom: "Jean" });
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

    const colocataires: { id: string; nom: string; prenom: string }[] = [];
    for (let i = 0; i < nombreColocataires; i++) {
      const colocataire = await locatairesService.create(userId, { nom: `Martin${i}`, prenom: `Alex${i}` });
      await bailLocatairesService.create({ bailId: bail.id, locataireId: colocataire.id, role: "colocataire" });
      colocataires.push(colocataire);
    }

    const etatDesLieux = await etatsDesLieuxService.create({ bailId: bail.id });
    return { etatDesLieuxId: etatDesLieux.id, titulaire, colocataires };
  }

  function dtoSignature(locataireIds: string[], overrides: Record<string, unknown> = {}) {
    return {
      bailleur: { nomAffiche: "Jimmy Ettori", luEtApprouve: true, imagePng: PNG_1X1_BASE64 },
      locataires: locataireIds.map((locataireId) => ({ locataireId, luEtApprouve: true, imagePng: PNG_1X1_BASE64 })),
      ...overrides
    };
  }

  it("entrée signée seule, 1 locataire : date/lieu/bailleur/locataire affichés pour l'entrée, pointillés conservés pour la sortie", async () => {
    const { etatDesLieuxId, titulaire } = await creerDossier(0);
    await avecContexte(() =>
      etatsDesLieuxSignatureService.signerEntree(etatDesLieuxId, dtoSignature([titulaire.id], { lieu: "Marseille" }))
    );

    const buffer = await avecContexte(() =>
      etatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx(etatDesLieuxId)
    );
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");

    const texte = texteDuDocx(buffer);
    expect(texte).toContain("Marseille");
    expect(texte).toContain("Lu et approuvé — Jimmy Ettori");
    expect(texte).toContain(`Lu et approuvé — ${titulaire.prenom} ${titulaire.nom}`);

    // Sortie non signée : les pointillés du modèle papier restent, aucune
    // ligne "Lu et approuvé" supplémentaire pour la sortie.
    const occurrencesLuEtApprouveImprimees = [...texte.matchAll(/Lu et approuvé — /g)].length;
    expect(occurrencesLuEtApprouveImprimees).toBe(2); // bailleur + 1 locataire, entrée seule

    expect(balisesResiduelles(buffer)).toEqual([]);
  });

  it("entrée et sortie signées, 1 locataire : les deux dates/lieux affichés, 4 lignes 'Lu et approuvé' (bailleur+locataire × 2 phases)", async () => {
    const { etatDesLieuxId, titulaire } = await creerDossier(0);
    await avecContexte(() =>
      etatsDesLieuxSignatureService.signerEntree(etatDesLieuxId, dtoSignature([titulaire.id], { lieu: "Marseille" }))
    );
    await avecContexte(() =>
      etatsDesLieuxSignatureService.signerSortie(etatDesLieuxId, dtoSignature([titulaire.id], { lieu: "Lyon" }))
    );

    const buffer = await avecContexte(() =>
      etatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx(etatDesLieuxId)
    );
    const texte = texteDuDocx(buffer);

    expect(texte).toContain("Marseille");
    expect(texte).toContain("Lyon");
    const occurrencesLuEtApprouveImprimees = [...texte.matchAll(/Lu et approuvé — /g)].length;
    expect(occurrencesLuEtApprouveImprimees).toBe(4); // (bailleur + 1 locataire) × 2 phases

    expect(balisesResiduelles(buffer)).toEqual([]);
  });

  it("entrée et sortie signées, 2 locataires (colocation) : les deux noms apparaissent pour chaque phase", async () => {
    const { etatDesLieuxId, titulaire, colocataires } = await creerDossier(1);
    const colocataire = colocataires[0]!;
    const idsLocataires = [titulaire.id, colocataire.id];

    await avecContexte(() => etatsDesLieuxSignatureService.signerEntree(etatDesLieuxId, dtoSignature(idsLocataires)));
    await avecContexte(() => etatsDesLieuxSignatureService.signerSortie(etatDesLieuxId, dtoSignature(idsLocataires)));

    const buffer = await avecContexte(() =>
      etatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx(etatDesLieuxId)
    );
    const texte = texteDuDocx(buffer);

    expect(texte).toContain(`Lu et approuvé — ${titulaire.prenom} ${titulaire.nom}`);
    expect(texte).toContain(`Lu et approuvé — ${colocataire.prenom} ${colocataire.nom}`);
    const occurrencesTitulaire = [...texte.matchAll(new RegExp(`Lu et approuvé — ${titulaire.prenom} ${titulaire.nom}`, "g"))].length;
    const occurrencesColocataire = [...texte.matchAll(new RegExp(`Lu et approuvé — ${colocataire.prenom} ${colocataire.nom}`, "g"))].length;
    expect(occurrencesTitulaire).toBe(2); // entrée + sortie
    expect(occurrencesColocataire).toBe(2); // entrée + sortie
    const occurrencesBailleur = [...texte.matchAll(/Lu et approuvé — Jimmy Ettori/g)].length;
    expect(occurrencesBailleur).toBe(2); // entrée + sortie

    expect(balisesResiduelles(buffer)).toEqual([]);
  });

  it("aucune signature : pointillés d'origine conservés pour l'entrée ET la sortie, aucune ligne 'Lu et approuvé' imprimée, zéro balise résiduelle", async () => {
    const { etatDesLieuxId } = await creerDossier(0);
    // Pose dateEntree à la main, sans aucune signature (cas papier) — les
    // pointillés du bloc signature doivent rester, même si dateEntree est
    // techniquement renseignée (le gel est piloté par
    // entreeSigneeParTous, jamais par dateEntree seule).
    await avecContexte(() => etatsDesLieuxService.updateHeader(etatDesLieuxId, { dateEntree: "2026-08-01" }));

    const buffer = await avecContexte(() =>
      etatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx(etatDesLieuxId)
    );
    const texte = texteDuDocx(buffer);
    expect(texte).not.toContain("Lu et approuvé — ");
    expect(balisesResiduelles(buffer)).toEqual([]);
  });
});
