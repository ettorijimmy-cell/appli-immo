import { randomUUID } from "crypto";
import path from "path";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  bailLocataires,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  locataires,
  organisations,
  paiements,
  utilisateurs,
  type Database
} from "db";
import { and, eq } from "drizzle-orm";
import PizZip from "pizzip";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AlertesJobService } from "../alertes/alertes-job.service";
import { AlertesModule } from "../alertes/alertes.module";
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

// Fixture minimale committée (générée par un script jetable, jamais le
// vrai modèle du propriétaire — voir bail-document-docx/__fixtures__ pour
// le même principe). Balises exactes attendues par
// QuittanceDocumentDocxService : {Nom du bailleur}, {Nom du locataire},
// {Adresse du logement}, {Periode}, {Montant loyer}, {Montant charges},
// {Montant total}, {Date de paiement}, {Ville emission}, {Date d'emission}.
const FIXTURE_TEMPLATE = path.join(__dirname, "__fixtures__", "modele-quittance-test.docx");
process.env["QUITTANCE_DOCUMENT_DOCX_TEMPLATE_PATH"] = FIXTURE_TEMPLATE;

function texteDuDocx(buffer: Buffer): string {
  const zip = new PizZip(buffer);
  const documentXml = zip.files["word/document.xml"];
  if (!documentXml) {
    throw new Error("word/document.xml introuvable dans le .docx généré");
  }
  const xml = documentXml.asText();
  return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(" ");
}

describe("Génération docx de la quittance (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let versementsService: VersementsService;
  let alertesJobService: AlertesJobService;
  let quittanceDocumentDocxService: QuittanceDocumentDocxService;
  let requestContextService: RequestContextService;
  let db: Database;
  let userId: string;
  let organisationId: string;
  let appartementId: string;

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

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Quittance Docx Intégration" })
      .returning();
    if (!organisation) throw new Error("Échec de l'insertion de l'organisation de test");

    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `quittance-docx-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "QuittanceDocx",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) throw new Error("Échec de l'insertion de l'utilisateur de test");
    userId = user.id;
    organisationId = organisation.id;

    const sci = await scisService.create(user.id, {
      nom: "SCI Quittance Docx Test",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(user.id, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Quittance Docx Test",
      adresse: "1 rue de la Quittance",
      codePostal: "19100",
      ville: "Brive",
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
    appartementId = appartement.id;
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  async function creerBailAvecTitulaire(): Promise<{ bailId: string }> {
    const bail = await bauxService.create({
      appartementId,
      typeBail: "vide",
      dateDebut: "2026-01-01",
      loyerMensuel: "700.00",
      provisionsCharges: "100.00",
      jourEcheance: 5
    });
    await bauxService.activer(bail.id);
    const [locataire] = await db.insert(locataires).values({ nom: "Devos", prenom: "Ilan", organisationId }).returning();
    if (!locataire) throw new Error("Échec de l'insertion du locataire de test");
    await db.insert(bailLocataires).values({ bailId: bail.id, locataireId: locataire.id, role: "titulaire" });
    return { bailId: bail.id };
  }

  it("génère un .docx complet pour une échéance de loyer figée (loyerHorsCharges/charges) et réglée", async () => {
    const { bailId } = await creerBailAvecTitulaire();
    // Échéance récurrente de février, générée avec loyerHorsCharges/charges
    // figés (contrairement à l'échéance d'entrée de janvier créée par
    // activer(), voir docs/backlog.md — dette technique).
    await alertesJobService.genererEcheancesRecurrentes("2026-02-10");
    const [echeanceFevrier] = await db
      .select()
      .from(paiements)
      .where(and(eq(paiements.bailId, bailId), eq(paiements.dateEcheance, "2026-02-05")));
    if (!echeanceFevrier) throw new Error("Échéance de février attendue introuvable");
    await versementsService.ajouter({
      paiementId: echeanceFevrier.id,
      montant: "800.00",
      mode: "virement",
      dateVersement: "2026-02-05"
    });

    const buffer = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      quittanceDocumentDocxService.genererDocumentQuittanceDocx(echeanceFevrier.id)
    );

    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");

    const texte = texteDuDocx(buffer);
    expect(texte).toContain("SCI Quittance Docx Test");
    expect(texte).toContain("Ilan Devos");
    expect(texte).toContain("Immeuble Quittance Docx Test");
    expect(texte).toContain("700.00");
    expect(texte).toContain("100.00");
    expect(texte).toContain("800.00");
    expect(texte).toContain("février 2026");
    expect(texte).toContain("2026-02-05");
    expect(texte).toContain("Brive");
  });

  it("bloque si le paiement n'est pas de type loyer ou n'est pas réglé (statut != paye)", async () => {
    const { bailId } = await creerBailAvecTitulaire();
    const [echeanceJanvier] = await db.select().from(paiements).where(eq(paiements.bailId, bailId)).limit(1);
    if (!echeanceJanvier) throw new Error("Échéance de janvier attendue introuvable");
    // Jamais réglée (aucun versement) : statut reste 'impaye'.

    await expect(
      requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
        quittanceDocumentDocxService.genererDocumentQuittanceDocx(echeanceJanvier.id)
      )
    ).rejects.toThrow(BadRequestException);
  });

  it("bloque si loyerHorsCharges/charges sont absents (échéance antérieure au 2026-08-31)", async () => {
    const { bailId } = await creerBailAvecTitulaire();
    // Échéance d'entrée générée par activer() : jamais figée à ce jour
    // (dette technique documentée, docs/backlog.md).
    const [echeanceJanvier] = await db.select().from(paiements).where(eq(paiements.bailId, bailId)).limit(1);
    if (!echeanceJanvier) throw new Error("Échéance de janvier attendue introuvable");
    expect(echeanceJanvier.loyerHorsCharges).toBeNull();
    await versementsService.ajouter({
      paiementId: echeanceJanvier.id,
      montant: echeanceJanvier.montant,
      mode: "virement",
      dateVersement: "2026-01-05"
    });

    let erreur: unknown;
    try {
      await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
        quittanceDocumentDocxService.genererDocumentQuittanceDocx(echeanceJanvier.id)
      );
    } catch (err) {
      erreur = err;
    }
    expect(erreur).toBeInstanceOf(BadRequestException);
    const reponse = (erreur as BadRequestException).getResponse() as { champsManquants: string[] };
    expect(reponse.champsManquants).toContain("Montant du loyer hors charges (échéance antérieure au 2026-08-31 ?)");
    expect(reponse.champsManquants).toContain("Montant des charges (échéance antérieure au 2026-08-31 ?)");
  });

  it("bloque si aucun titulaire actif n'est rattaché au bail", async () => {
    const bail = await bauxService.create({
      appartementId,
      typeBail: "vide",
      dateDebut: "2026-01-01",
      loyerMensuel: "700.00",
      provisionsCharges: "100.00",
      jourEcheance: 5
    });
    await bauxService.activer(bail.id);
    await alertesJobService.genererEcheancesRecurrentes("2026-02-10");
    const [echeanceFevrier] = await db
      .select()
      .from(paiements)
      .where(and(eq(paiements.bailId, bail.id), eq(paiements.dateEcheance, "2026-02-05")));
    if (!echeanceFevrier) throw new Error("Échéance de février attendue introuvable");
    await versementsService.ajouter({
      paiementId: echeanceFevrier.id,
      montant: "800.00",
      mode: "virement",
      dateVersement: "2026-02-05"
    });
    // Aucun bail_locataires inséré.

    let erreur: unknown;
    try {
      await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
        quittanceDocumentDocxService.genererDocumentQuittanceDocx(echeanceFevrier.id)
      );
    } catch (err) {
      erreur = err;
    }
    expect(erreur).toBeInstanceOf(BadRequestException);
    const reponse = (erreur as BadRequestException).getResponse() as { champsManquants: string[] };
    expect(reponse.champsManquants).toContain("Nom du locataire");
  });

  it("bloque avec NotFoundException si le paiement n'existe pas", async () => {
    await expect(
      requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
        quittanceDocumentDocxService.genererDocumentQuittanceDocx(randomUUID())
      )
    ).rejects.toThrow(NotFoundException);
  });
});
