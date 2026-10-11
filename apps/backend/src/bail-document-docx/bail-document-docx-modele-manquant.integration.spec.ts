import path from "path";
import { InternalServerErrorException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { bien as bienTable, createDbClient, DEFAULT_DEV_DATABASE_URL, indicesIrl, organisations, utilisateurs, type Database } from "db";
import { eq } from "drizzle-orm";
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

// Chemin volontairement inexistant — reproduit un déploiement où
// l'asset n'a pas été copié dans l'image (défaut avant ce chantier).
// Fichier de test dédié (plutôt qu'un cas de plus dans
// bail-document-docx.integration.spec.ts) car il fixe
// BAIL_DOCUMENT_DOCX_TEMPLATE_PATH au chargement du module, une valeur
// incompatible avec tous les autres tests de ce dossier qui ont besoin
// de la vraie fixture.
const CHEMIN_INEXISTANT = path.join(__dirname, "__fixtures__", "modele-qui-n-existe-pas.docx");
process.env["BAIL_DOCUMENT_DOCX_TEMPLATE_PATH"] = CHEMIN_INEXISTANT;

describe("BailDocumentDocxService — modèle introuvable (intégration Postgres réelle)", () => {
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
  let userId: string;
  let bailId: string;

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

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Bail Docx Modèle Manquant" })
      .returning();
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation!.id,
        email: "bail-docx-modele-manquant@example.com",
        nom: "Test",
        prenom: "BailDocxModeleManquant",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    userId = user!.id;

    await db.insert(indicesIrl).values({ annee: 9700, trimestre: 2, valeur: "148.37" });

    const sci = await scisService.create(userId, { nom: "SCI Modèle Manquant", regimeFiscal: "IR", adresse: "1 rue de Test", codePostal: "75001", ville: "Paris" });
    await scisService.update(sci.id, { telephone: "0555555555", estFamiliale: true });

    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Modèle Manquant",
      adresse: "1 rue de Test",
      codePostal: "19100",
      ville: "Brive",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    await db.update(bienTable).set({ anneeConstruction: 1998 }).where(eq(bienTable.id, bien.id));

    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: "unique",
      type: "T3",
      surface: "60.00",
      loyerReference: "650.00",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    await appartementsService.update(appartement.id, { equipementCuisine: "Plaques, four, réfrigérateur", dependancesAnnexes: "Cave" });

    const locataire = await locatairesService.create(userId, { nom: "Dupont", prenom: "Alice" });
    await locatairesService.update(locataire.id, {
      adresse: "1 rue du Locataire",
      codePostal: "19100",
      ville: "Brive",
      dateNaissance: "1990-05-12",
      telephone: "0611111111",
      email: "alice-modele-manquant@example.com"
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
    bailId = bail.id;
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  it("lève une InternalServerErrorException avec un message exploitable, sans exposer le chemin du serveur", async () => {
    let erreurCapturee: unknown;
    try {
      await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
        bailDocumentDocxService.genererDocumentBailDocx(bailId, {})
      );
    } catch (erreur) {
      erreurCapturee = erreur;
    }

    expect(erreurCapturee).toBeInstanceOf(InternalServerErrorException);
    const message = (erreurCapturee as InternalServerErrorException).message;
    // Message utile côté desktop (pas un "Internal Server Error" muet)...
    expect(message).toContain("modèle de bail");
    // ...mais sans jamais révéler un chemin de fichier serveur au client.
    expect(message).not.toContain(CHEMIN_INEXISTANT);
    expect(message).not.toContain(__dirname);
  });
});
