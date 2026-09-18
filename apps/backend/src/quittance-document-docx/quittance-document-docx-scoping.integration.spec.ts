import { randomUUID } from "crypto";
import path from "path";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { bailLocataires, createDbClient, DEFAULT_DEV_DATABASE_URL, locataires, organisations, paiements, utilisateurs, type Database } from "db";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlertesJobService } from "../alertes/alertes-job.service";
import { AlertesModule } from "../alertes/alertes.module";
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
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { PaiementsModule } from "../paiements/paiements.module";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { VersementsModule } from "../versements/versements.module";
import { VersementsService } from "../versements/versements.service";
import { QuittanceDocumentDocxModule } from "./quittance-document-docx.module";
import { QuittanceDocumentDocxService } from "./quittance-document-docx.service";

// Fixture minimale committée réutilisée telle quelle (voir
// quittance-document-docx.integration.spec.ts).
const FIXTURE_TEMPLATE = path.join(__dirname, "__fixtures__", "modele-quittance-test.docx");
process.env["QUITTANCE_DOCUMENT_DOCX_TEMPLATE_PATH"] = FIXTURE_TEMPLATE;

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  paiementId: string;
}

// Commit B2 (chantier scoping multi-organisation, 2026-09-18) :
// genererDocumentQuittanceDocx(paiementId) refait sa propre requête SQL
// (paiement -> bail -> appartement -> bien), sans jamais réutiliser
// PaiementsService.findById() — même raisonnement que B1
// (bail-document-docx-scoping.integration.spec.ts). rendreDocument
// (privé) espionné via un type structurel, jamais un cast `any`.
describe("QuittanceDocumentDocxService — contrôle d'appartenance à l'organisation (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let versementsService: VersementsService;
  let alertesJobService: AlertesJobService;
  let quittanceDocumentDocxService: QuittanceDocumentDocxService;
  let requestContextService: RequestContextService;
  let auditService: AuditService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Quittance Docx Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `quittance-docx-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `QuittanceDocxScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    const userId = user.id;

    const sci = await scisService.create(userId, {
      nom: `SCI Quittance Docx Scoping ${suffixe}`,
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: `Immeuble Quittance Docx Scoping ${suffixe}`,
      adresse: "1 rue de la Quittance",
      codePostal: "19100",
      ville: "Brive",
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
      loyerMensuel: "700.00",
      provisionsCharges: "100.00",
      jourEcheance: 5
    });
    await bauxService.activer(bail.id);
    const [locataire] = await db
      .insert(locataires)
      .values({ nom: "Devos", prenom: `Ilan${suffixe}`, organisationId: organisation.id })
      .returning();
    if (!locataire) {
      throw new Error("Échec de l'insertion du locataire de test");
    }
    await db.insert(bailLocataires).values({ bailId: bail.id, locataireId: locataire.id, role: "titulaire" });

    await alertesJobService.genererEcheancesRecurrentes("2026-02-10");
    const [echeanceFevrier] = await db
      .select()
      .from(paiements)
      .where(and(eq(paiements.bailId, bail.id), eq(paiements.dateEcheance, "2026-02-05")));
    if (!echeanceFevrier) {
      throw new Error("Échéance de février attendue introuvable");
    }
    await versementsService.ajouter({
      paiementId: echeanceFevrier.id,
      montant: "800.00",
      mode: "virement",
      dateVersement: "2026-02-05"
    });

    return { organisationId: organisation.id, userId, paiementId: echeanceFevrier.id };
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
        BauxModule,
        PaiementsModule,
        VersementsModule,
        AlertesModule,
        QuittanceDocumentDocxModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    bauxService = moduleRef.get(BauxService);
    versementsService = moduleRef.get(VersementsService);
    alertesJobService = moduleRef.get(AlertesJobService);
    quittanceDocumentDocxService = moduleRef.get(QuittanceDocumentDocxService);
    requestContextService = moduleRef.get(RequestContextService);
    auditService = moduleRef.get(AuditService);

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
  });

  function contexteOrgA<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte({ utilisateurId: orgA.userId, organisationId: orgA.organisationId }, fn);
  }
  function contexteOrgB<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte({ utilisateurId: orgB.userId, organisationId: orgB.organisationId }, fn);
  }

  it("génère normalement la quittance quand le paiement appartient à l'organisation appelante", async () => {
    const buffer = await contexteOrgA(() =>
      quittanceDocumentDocxService.genererDocumentQuittanceDocx(orgA.paiementId)
    );
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");
  });

  it("404 sur le paiementId d'une autre organisation, sans jamais générer la quittance ni journaliser", async () => {
    const rendreDocumentSpy = vi.spyOn(
      quittanceDocumentDocxService as unknown as { rendreDocument: (...args: unknown[]) => Buffer },
      "rendreDocument"
    );
    const auditSpy = vi.spyOn(auditService, "logAccesDonneeSensible");

    await expect(
      contexteOrgB(() => quittanceDocumentDocxService.genererDocumentQuittanceDocx(orgA.paiementId))
    ).rejects.toThrow(NotFoundException);

    expect(rendreDocumentSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it("404 sur un paiementId inexistant, sans jamais générer la quittance", async () => {
    const rendreDocumentSpy = vi.spyOn(
      quittanceDocumentDocxService as unknown as { rendreDocument: (...args: unknown[]) => Buffer },
      "rendreDocument"
    );

    await expect(
      contexteOrgA(() => quittanceDocumentDocxService.genererDocumentQuittanceDocx(randomUUID()))
    ).rejects.toThrow(NotFoundException);

    expect(rendreDocumentSpy).not.toHaveBeenCalled();
  });

  it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
    const buffer = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
      quittanceDocumentDocxService.genererDocumentQuittanceDocx(orgA.paiementId)
    );
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");
  });
});
