import { randomUUID } from "crypto";
import path from "path";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, utilisateurs, type Database } from "db";
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

// Fixture committée réutilisée telle quelle (voir
// etat-des-lieux-document-docx.integration.spec.ts).
const FIXTURE_TEMPLATE = path.join(__dirname, "__fixtures__", "modele-etat-des-lieux-test.docx");
process.env["ETAT_DES_LIEUX_DOCUMENT_DOCX_TEMPLATE_PATH"] = FIXTURE_TEMPLATE;

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  etatDesLieuxId: string;
}

// Sous-commit 5c (chantier scoping multi-organisation, 2026-09-18) : B3
// (audit du Commit 5) — genererDocumentEtatDesLieuxDocx() appelle
// EtatsDesLieuxService.findById() en interne, sans jamais refaire sa
// propre requête (contrairement à B1/B2/B4/B5, corrigés séparément) :
// le contrôle d'appartenance ajouté sur findById() ferme donc B3 par
// ricochet, sans aucune modification de ce service. Ce fichier confirme
// à la fois qu'une génération légitime (même organisation) continue de
// fonctionner normalement, et qu'une génération cross-org échoue
// désormais proprement (404, jamais le docx).
describe("EtatDesLieuxDocumentDocxService — fermeture de B3 par le contrôle d'appartenance de EtatsDesLieuxService.findById (intégration Postgres réelle)", () => {
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
  let etatDesLieuxDocumentDocxService: EtatDesLieuxDocumentDocxService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation EDL Docx Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `edl-docx-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `EdlDocxScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    const userId = user.id;

    const sci = await scisService.create(userId, {
      nom: `SCI EDL Docx Scoping ${suffixe}`,
      regimeFiscal: "IR",
      adresse: "1 avenue de la République",
      codePostal: "75011",
      ville: "Paris"
    });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: `Immeuble EDL Docx Scoping ${suffixe}`,
      adresse: "12 rue des Lilas",
      codePostal: "75011",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: suffixe,
      type: "T3",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    await appartementsService.update(appartement.id, {
      nombreChambres: 1,
      nombreSallesDeBain: 1,
      nombreWc: 1
    });
    const locataire = await locatairesService.create(userId, { nom: "Dupont", prenom: `Alice${suffixe}` });
    const bail = await bauxService.create({
      appartementId: appartement.id,
      typeBail: "vide",
      dateDebut: "2026-08-01",
      loyerMensuel: "650.00",
      depotGarantie: "650.00",
      provisionsCharges: "30.00",
      jourEcheance: 5
    });
    await bailLocatairesService.create({ bailId: bail.id, locataireId: locataire.id, role: "titulaire" });
    const etatDesLieux = await etatsDesLieuxService.create({ bailId: bail.id });
    await etatsDesLieuxService.updateHeader(etatDesLieux.id, { dateEntree: "2026-08-01" });

    return { organisationId: organisation.id, userId, etatDesLieuxId: etatDesLieux.id };
  }

  beforeEach(async () => {
    db = await begin();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        CommonModule,
        DatabaseModule,
        AuditModule,
        UsersModule,
        AuthModule,
        ScisModule,
        BienModule,
        AppartementsModule,
        LocatairesModule,
        BauxModule,
        BailLocatairesModule,
        EncryptionModule,
        DocumentsModule,
        EtatsDesLieuxModule,
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
    etatDesLieuxDocumentDocxService = moduleRef.get(EtatDesLieuxDocumentDocxService);
    requestContextService = moduleRef.get(RequestContextService);

    orgA = await creerFixtureOrganisation("A");
    orgB = await creerFixtureOrganisation("B");
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  function contexteOrgA<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte({ utilisateurId: orgA.userId, organisationId: orgA.organisationId }, fn);
  }
  function contexteOrgB<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte({ utilisateurId: orgB.userId, organisationId: orgB.organisationId }, fn);
  }

  it("génère normalement le docx quand l'état des lieux appartient à l'organisation appelante (chemin légitime non cassé)", async () => {
    const buffer = await contexteOrgA(() =>
      etatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx(orgA.etatDesLieuxId)
    );
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");
  });

  it("404 sur l'etatDesLieuxId d'une autre organisation — B3 est désormais fermé", async () => {
    await expect(
      contexteOrgB(() => etatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx(orgA.etatDesLieuxId))
    ).rejects.toThrow(NotFoundException);
  });

  it("404 sur un etatDesLieuxId inexistant", async () => {
    await expect(
      contexteOrgA(() => etatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx(randomUUID()))
    ).rejects.toThrow(NotFoundException);
  });
});
