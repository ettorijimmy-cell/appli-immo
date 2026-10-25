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

// Même fixture committée que etat-des-lieux-document-docx.integration.spec.ts.
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
  return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(" ");
}

// Vérifie le point 1 de la revue du verrou (chantier Signatures, 2026-10-25) :
// une ligne d'équipements divers ajoutée APRÈS la signature d'entrée (donc
// sans aucune valeur d'entrée, seulement une identité + des valeurs de
// sortie — "élément absent à l'entrée, présent à la sortie") doit
// s'afficher correctement dans le .docx généré : jamais "null"/"undefined"
// littéral, jamais de plantage, une case "Entrée" simplement vide.
describe("Génération docx — ligne ajoutée après l'entrée, sans valeurs d'entrée (intégration Postgres réelle)", () => {
  const storageDirTest = path.join(os.tmpdir(), `appli-immo-test-docx-ligne-sans-entree-${randomUUID()}`);
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
      .values({ type: "particulier", nom: "Organisation Docx Ligne Sans Entree Test" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `docx-ligne-sans-entree-${randomUUID()}@example.com`,
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

  it("affiche une ligne d'équipements divers sans valeurs d'entrée (case Entrée vide, valeurs de sortie présentes)", async () => {
    const sci = await scisService.create(userId, {
      nom: "SCI Docx Ligne Sans Entree",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Docx Ligne Sans Entree",
      adresse: "1 rue de Test",
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
    const etatDesLieux = await etatsDesLieuxService.create({ bailId: bail.id });

    // Au moins une ligne d'entrée "normale" pour ne pas tester un cas vide.
    await avecContexte(() =>
      etatsDesLieuxService.submitEquipementsDivers(etatDesLieux.id, {
        lignes: [{ libelle: "Tondeuse", nombreEntree: 1, etatEntree: "bon" }]
      })
    );

    const dtoSignature = (overrides: Record<string, unknown> = {}) => ({
      bailleur: { nomAffiche: "Jimmy Ettori", luEtApprouve: true, imagePng: PNG_1X1_BASE64 },
      locataires: [{ locataireId: titulaire.id, luEtApprouve: true, imagePng: PNG_1X1_BASE64 }],
      ...overrides
    });
    await avecContexte(() => etatsDesLieuxSignatureService.signerEntree(etatDesLieux.id, dtoSignature()));

    // Ligne ajoutée APRÈS la signature d'entrée : élément absent à
    // l'entrée, remis en cours de bail — aucun champ "entree", seulement
    // l'identité (libelle) et les champs "sortie".
    await avecContexte(() =>
      etatsDesLieuxService.submitEquipementsDivers(etatDesLieux.id, {
        lignes: [{ libelle: "Télécommande portail (remise en cours de bail)", nombreSortie: 1, etatSortie: "bon" }]
      })
    );

    await avecContexte(() => etatsDesLieuxSignatureService.signerSortie(etatDesLieux.id, dtoSignature()));

    const buffer = await avecContexte(() =>
      etatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx(etatDesLieux.id)
    );
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");

    const texte = texteDuDocx(buffer);
    expect(texte).toContain("Tondeuse");
    expect(texte).toContain("Télécommande portail (remise en cours de bail)");
    // Jamais de rendu brut d'une valeur absente.
    expect(texte).not.toMatch(/\bnull\b/);
    expect(texte).not.toMatch(/\bundefined\b/);
  });
});
