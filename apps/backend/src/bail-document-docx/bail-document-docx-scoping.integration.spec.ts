import { randomUUID } from "crypto";
import path from "path";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { bien as bienTable, createDbClient, DEFAULT_DEV_DATABASE_URL, indicesIrl, organisations, utilisateurs, type Database } from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuditModule } from "../audit/audit.module";
import { AuditService } from "../audit/audit.service";
import { AuthModule } from "../auth/auth.module";
import { BailLocatairesModule } from "../bail-locataires/bail-locataires.module";
import { BailLocatairesService } from "../bail-locataires/bail-locataires.service";
import { BauxModule } from "../baux/baux.module";
import { BauxService } from "../baux/baux.service";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { VersementsModule } from "../versements/versements.module";
import { BailDocumentDocxModule } from "./bail-document-docx.module";
import { BailDocumentDocxService } from "./bail-document-docx.service";

// Fixture committée réutilisée telle quelle (voir
// bail-document-docx.integration.spec.ts pour le détail des corrections
// apportées au modèle réel du propriétaire).
const FIXTURE_TEMPLATE = path.join(__dirname, "__fixtures__", "modele-bail-test.docx");
process.env["BAIL_DOCUMENT_DOCX_TEMPLATE_PATH"] = FIXTURE_TEMPLATE;

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  bailId: string;
}

// Commit B1 (chantier scoping multi-organisation, 2026-09-18) :
// genererDocumentBailDocx(bailId) refait sa propre requête SQL (bail ->
// appartement -> bien), sans jamais réutiliser BauxService.findById() —
// vérifie donc son propre contrôle d'appartenance, indépendamment de la
// Catégorie A (non traitée dans ce commit). rendreDocument (privé) est
// espionné via un type structurel plutôt qu'un cast `any` (interdit sans
// justification, CLAUDE.md) : preuve que le docx n'est jamais généré sur
// le chemin refusé, pas seulement que l'erreur 404 est levée.
describe("BailDocumentDocxService — contrôle d'appartenance à l'organisation (intégration Postgres réelle)", () => {
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
  let bailDocumentDocxService: BailDocumentDocxService;
  let requestContextService: RequestContextService;
  let auditService: AuditService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string, anneeIrl: number): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Bail Docx Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `bail-docx-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `BailDocxScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    const userId = user.id;

    // Année délibérément hors plage réaliste (voir bail-document-docx
    // .integration.spec.ts) pour ne jamais entrer en collision avec une
    // vraie ligne IRL ni avec l'autre organisation de ce test.
    await db.insert(indicesIrl).values({ annee: anneeIrl, trimestre: 2, valeur: "148.37" });

    const sci = await scisService.create(userId, {
      nom: `SCI Bail Docx Scoping ${suffixe}`,
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    await scisService.update(sci.id, { telephone: "0555555555", estFamiliale: true });

    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: `Immeuble Bail Docx Scoping ${suffixe}`,
      adresse: "1 rue de Test",
      codePostal: "19100",
      ville: "Brive",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    await db.update(bienTable).set({ anneeConstruction: 1998 }).where(eq(bienTable.id, bien.id));

    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: suffixe,
      type: "T3",
      surface: "60.00",
      loyerReference: "650.00",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    await appartementsService.update(appartement.id, {
      equipementCuisine: "Plaques, four, réfrigérateur",
      dependancesAnnexes: "Cave"
    });

    const locataire = await locatairesService.create(userId, { nom: "Dupont", prenom: `Alice${suffixe}` });
    await locatairesService.update(locataire.id, {
      adresse: "1 rue du Locataire",
      codePostal: "19100",
      ville: "Brive",
      dateNaissance: "1990-05-12",
      telephone: "0611111111",
      email: `alice-bail-docx-scoping-${suffixe}@example.com`
    });

    const bail = await bauxService.create({
      appartementId: appartement.id,
      typeBail: "vide",
      dateDebut: "2026-07-01",
      loyerMensuel: "650.00",
      depotGarantie: "650.00",
      provisionsCharges: "30.00",
      jourEcheance: 5
    });
    await bailLocatairesService.create({ bailId: bail.id, locataireId: locataire.id, role: "titulaire" });

    return { organisationId: organisation.id, userId, bailId: bail.id };
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
        VersementsModule,
        BailDocumentDocxModule
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
    bailDocumentDocxService = moduleRef.get(BailDocumentDocxService);
    requestContextService = moduleRef.get(RequestContextService);
    auditService = moduleRef.get(AuditService);

    orgA = await creerFixtureOrganisation("A", 9981);
    orgB = await creerFixtureOrganisation("B", 9982);
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

  it("génère normalement le docx quand le bail appartient à l'organisation appelante", async () => {
    const buffer = await contexteOrgA(() => bailDocumentDocxService.genererDocumentBailDocx(orgA.bailId, {}));
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");
  });

  it("404 sur le bailId d'une autre organisation, sans jamais générer le docx ni journaliser", async () => {
    const rendreDocumentSpy = vi.spyOn(
      bailDocumentDocxService as unknown as { rendreDocument: (...args: unknown[]) => Buffer },
      "rendreDocument"
    );
    const auditSpy = vi.spyOn(auditService, "logAccesDonneeSensible");

    await expect(
      contexteOrgB(() => bailDocumentDocxService.genererDocumentBailDocx(orgA.bailId, {}))
    ).rejects.toThrow(NotFoundException);

    expect(rendreDocumentSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it("404 sur un bailId inexistant, sans jamais générer le docx", async () => {
    const rendreDocumentSpy = vi.spyOn(
      bailDocumentDocxService as unknown as { rendreDocument: (...args: unknown[]) => Buffer },
      "rendreDocument"
    );

    await expect(
      contexteOrgA(() => bailDocumentDocxService.genererDocumentBailDocx(randomUUID(), {}))
    ).rejects.toThrow(NotFoundException);

    expect(rendreDocumentSpy).not.toHaveBeenCalled();
  });

  it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
    const buffer = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
      bailDocumentDocxService.genererDocumentBailDocx(orgA.bailId, {})
    );
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");
  });
});
