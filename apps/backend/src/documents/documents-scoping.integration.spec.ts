import { randomUUID } from "crypto";
import { rm } from "fs/promises";
import os from "os";
import path from "path";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, immeublesLegacy, organisations, utilisateurs, type Database } from "db";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { BauxModule } from "../baux/baux.module";
import { BauxService } from "../baux/baux.service";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CandidatsModule } from "../candidats/candidats.module";
import { CandidatsService } from "../candidats/candidats.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { DepensesModule } from "../depenses/depenses.module";
import { DepensesService } from "../depenses/depenses.service";
import { EtatsDesLieuxModule } from "../etats-des-lieux/etats-des-lieux.module";
import { EtatsDesLieuxService } from "../etats-des-lieux/etats-des-lieux.service";
import { GarantsModule } from "../garants/garants.module";
import { GarantsService } from "../garants/garants.service";
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { SinistresModule } from "../sinistres/sinistres.module";
import { SinistresService } from "../sinistres/sinistres.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { DocumentsModule } from "./documents.module";
import { DocumentsService } from "./documents.service";
import type { DocumentEntiteType } from "./dto/create-document.dto";

function fichierTest(contenu: string, nom: string): Express.Multer.File {
  return {
    originalname: nom,
    mimetype: "application/pdf",
    buffer: Buffer.from(contenu, "utf8"),
    size: Buffer.byteLength(contenu, "utf8")
  } as Express.Multer.File;
}

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  sciId: string;
  immeubleLegacyId: string;
  bienId: string;
  appartementId: string;
  bailId: string;
  etatDesLieuxId: string;
  locataireId: string;
  garantId: string;
  candidatId: string;
  depenseId: string;
  sinistreId: string;
}

// Sous-commit 4c (chantier scoping multi-organisation, 2026-09-18) :
// DocumentsService.findAll() ne filtrait jusqu'ici jamais par
// organisation, quel que soit entiteType — 11 valeurs réelles (l'audit
// initial en comptait 7 ; bien/depense/candidat/sinistre ont été ajoutées
// depuis). Chaque entiteType a son propre chemin de résolution vers
// bien.organisationId (ou une colonne organisationId propre) — vérifié
// individuellement, jamais généralisé. Ce fichier construit une fixture
// complète par organisation (les 11 entités cibles) pour tester chaque
// chemin séparément, plus le cas où entiteType est absent (écran
// "Documents" global, DocumentsListView.tsx, qui liste réellement tous
// les entiteType sans filtre).
describe("DocumentsService.findAll — scoping par organisation, 11 entiteType (intégration Postgres réelle)", () => {
  const storageDirTest = path.join(os.tmpdir(), `appli-immo-test-documents-scoping-${randomUUID()}`);
  process.env["DOCUMENTS_STORAGE_DIR"] = storageDirTest;

  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let etatsDesLieuxService: EtatsDesLieuxService;
  let locatairesService: LocatairesService;
  let garantsService: GarantsService;
  let candidatsService: CandidatsService;
  let depensesService: DepensesService;
  let sinistresService: SinistresService;
  let documentsService: DocumentsService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Documents Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `documents-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `Scoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    const userId = user.id;

    const sci = await scisService.create(userId, {
      nom: `SCI Documents Scoping ${suffixe}`,
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const [immeubleLegacy] = await db
      .insert(immeublesLegacy)
      .values({ sciId: sci.id, nom: `Immeuble Legacy ${suffixe}`, adresse: "1 rue de Test" })
      .returning();
    if (!immeubleLegacy) {
      throw new Error("Échec de l'insertion de l'immeuble legacy de test");
    }
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: `Immeuble Documents Scoping ${suffixe}`,
      adresse: "1 rue des Documents",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartementCree = await appartementsService.create({
      bienId: bien.id,
      numero: suffixe,
      type: "T2",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel",
      loyerReference: "800.00"
    });
    // Composition (nombreChambres/nombreSallesDeBain/nombreWc) non exposée
    // à la création (CreateAppartementDto) — requise par
    // validerCompletudeEtatDesLieux avant tout etat_des_lieux, renseignée
    // via update() comme le ferait la fiche appartement en usage réel.
    const appartement = await appartementsService.update(appartementCree.id, {
      nombreChambres: 1,
      nombreSallesDeBain: 1,
      nombreWc: 1
    });
    const bail = await bauxService.create({
      appartementId: appartement.id,
      typeBail: "vide",
      dateDebut: "2026-08-01",
      jourEcheance: 5
    });
    const etatDesLieux = await etatsDesLieuxService.create({ bailId: bail.id });
    const locataire = await locatairesService.create(userId, { nom: "Dupont", prenom: `Alice${suffixe}` });
    const garant = await garantsService.create({
      bailId: bail.id,
      nom: "Durand",
      prenom: `Claire${suffixe}`,
      typeGarantie: "personne_physique"
    });
    const candidatCree = await candidatsService.create(userId, { nom: "Petit", prenom: `Julien${suffixe}` });
    const depenseCreee = await depensesService.create(userId, {
      categorie: "reparation_entretien",
      montant: "100.00",
      dateDepense: "2026-08-10",
      libelle: `Dépense ${suffixe}`,
      bienId: bien.id
    });
    const sinistreCree = await sinistresService.create(userId, {
      type: "degat_eaux",
      bienId: bien.id,
      dateDeclaration: "2026-08-15"
    });

    return {
      organisationId: organisation.id,
      userId,
      sciId: sci.id,
      immeubleLegacyId: immeubleLegacy.id,
      bienId: bien.id,
      appartementId: appartement.id,
      bailId: bail.id,
      etatDesLieuxId: etatDesLieux.id,
      locataireId: locataire.id,
      garantId: garant.id,
      candidatId: candidatCree.id,
      depenseId: depenseCreee.id,
      sinistreId: sinistreCree.id
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
        BauxModule,
        EtatsDesLieuxModule,
        LocatairesModule,
        GarantsModule,
        CandidatsModule,
        DepensesModule,
        SinistresModule,
        DocumentsModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    bauxService = moduleRef.get(BauxService);
    etatsDesLieuxService = moduleRef.get(EtatsDesLieuxService);
    locatairesService = moduleRef.get(LocatairesService);
    garantsService = moduleRef.get(GarantsService);
    candidatsService = moduleRef.get(CandidatsService);
    depensesService = moduleRef.get(DepensesService);
    sinistresService = moduleRef.get(SinistresService);
    documentsService = moduleRef.get(DocumentsService);
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
    await rm(storageDirTest, { recursive: true, force: true });
  });

  // Upload hors contexte HTTP (comme le beforeEach) : verifierEntiteExiste
  // n'est pas concerné par le scoping (Commit 5, pas ce sous-commit), les
  // deux organisations peuvent donc uploader librement pendant la
  // préparation des fixtures.
  async function uploaderPourLesDeuxOrganisations(
    entiteType: DocumentEntiteType,
    entiteIdA: string,
    entiteIdB: string,
    categorie: Parameters<DocumentsService["upload"]>[0]["categorie"] = "photo"
  ) {
    const extra = entiteType === "candidat" ? ({ candidatRole: "candidat" } as const) : {};
    const documentOrgA = await documentsService.upload(
      { entiteType, entiteId: entiteIdA, categorie, ...extra },
      fichierTest(`contenu-${entiteType}-A`, `${entiteType}-A.pdf`)
    );
    const documentOrgB = await documentsService.upload(
      { entiteType, entiteId: entiteIdB, categorie, ...extra },
      fichierTest(`contenu-${entiteType}-B`, `${entiteType}-B.pdf`)
    );
    return { documentOrgA, documentOrgB };
  }

  async function verifierIsolation(entiteType: DocumentEntiteType, entiteIdA: string, entiteIdB: string) {
    const { documentOrgA, documentOrgB } = await uploaderPourLesDeuxOrganisations(entiteType, entiteIdA, entiteIdB);

    const listeOrgA = await requestContextService.executerAvecContexte(
      { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
      () => documentsService.findAll({ entiteType })
    );
    expect(listeOrgA.map((d) => d.id)).toContain(documentOrgA.id);
    expect(listeOrgA.map((d) => d.id)).not.toContain(documentOrgB.id);

    const listeOrgB = await requestContextService.executerAvecContexte(
      { utilisateurId: orgB.userId, organisationId: orgB.organisationId },
      () => documentsService.findAll({ entiteType })
    );
    expect(listeOrgB.map((d) => d.id)).toContain(documentOrgB.id);
    expect(listeOrgB.map((d) => d.id)).not.toContain(documentOrgA.id);
  }

  it("entiteType='sci' — colonne organisationId absente, résolu via organisation_sci", async () => {
    await verifierIsolation("sci", orgA.sciId, orgB.sciId);
  });

  it("entiteType='immeuble' — immeubles_legacy, résolu via scis -> organisation_sci", async () => {
    await verifierIsolation("immeuble", orgA.immeubleLegacyId, orgB.immeubleLegacyId);
  });

  it("entiteType='bien' — colonne organisationId propre, sans jointure", async () => {
    await verifierIsolation("bien", orgA.bienId, orgB.bienId);
  });

  it("entiteType='appartement' — résolu via une jointure simple vers bien", async () => {
    await verifierIsolation("appartement", orgA.appartementId, orgB.appartementId);
  });

  it("entiteType='bail' — résolu via une double jointure appartements -> bien", async () => {
    await verifierIsolation("bail", orgA.bailId, orgB.bailId);
  });

  it("entiteType='etat_des_lieux' — résolu via une triple jointure baux -> appartements -> bien", async () => {
    await verifierIsolation("etat_des_lieux", orgA.etatDesLieuxId, orgB.etatDesLieuxId);
  });

  it("entiteType='locataire' — colonne organisationId propre, sans jointure", async () => {
    await verifierIsolation("locataire", orgA.locataireId, orgB.locataireId);
  });

  it("entiteType='garant' — colonne organisationId propre (dénormalisée à la création), sans jointure", async () => {
    await verifierIsolation("garant", orgA.garantId, orgB.garantId);
  });

  it("entiteType='depense' — colonne organisationId propre, sans jointure", async () => {
    await verifierIsolation("depense", orgA.depenseId, orgB.depenseId);
  });

  it("entiteType='candidat' — colonne organisationId propre, sans jointure", async () => {
    await verifierIsolation("candidat", orgA.candidatId, orgB.candidatId);
  });

  it("entiteType='sinistre' — colonne organisationId propre, sans jointure", async () => {
    await verifierIsolation("sinistre", orgA.sinistreId, orgB.sinistreId);
  });

  // Cas sans entiteType (écran "Documents" global, DocumentsListView.tsx) :
  // les 11 résolutions doivent se combiner en OR sans qu'aucune ne fuite
  // vers l'autre organisation ni ne masque les autres types de la même
  // organisation. Un sous-ensemble représentatif suffit à prouver la
  // combinaison (un cas à colonne directe, un cas à jointure, un cas via
  // organisation_sci) — les 11 chemins individuels sont déjà couverts
  // ci-dessus.
  it("findAll() sans entiteType (écran global) combine les 11 résolutions en OR, sans fuite ni omission", async () => {
    const { documentOrgA: bienOrgA, documentOrgB: bienOrgB } = await uploaderPourLesDeuxOrganisations(
      "bien",
      orgA.bienId,
      orgB.bienId
    );
    const { documentOrgA: bailOrgA, documentOrgB: bailOrgB } = await uploaderPourLesDeuxOrganisations(
      "bail",
      orgA.bailId,
      orgB.bailId
    );
    const { documentOrgA: sciOrgA, documentOrgB: sciOrgB } = await uploaderPourLesDeuxOrganisations(
      "sci",
      orgA.sciId,
      orgB.sciId
    );

    const listeOrgA = await requestContextService.executerAvecContexte(
      { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
      () => documentsService.findAll({})
    );
    const idsOrgA = listeOrgA.map((d) => d.id);
    expect(idsOrgA).toContain(bienOrgA.id);
    expect(idsOrgA).toContain(bailOrgA.id);
    expect(idsOrgA).toContain(sciOrgA.id);
    expect(idsOrgA).not.toContain(bienOrgB.id);
    expect(idsOrgA).not.toContain(bailOrgB.id);
    expect(idsOrgA).not.toContain(sciOrgB.id);

    const listeOrgB = await requestContextService.executerAvecContexte(
      { utilisateurId: orgB.userId, organisationId: orgB.organisationId },
      () => documentsService.findAll({})
    );
    const idsOrgB = listeOrgB.map((d) => d.id);
    expect(idsOrgB).toContain(bienOrgB.id);
    expect(idsOrgB).toContain(bailOrgB.id);
    expect(idsOrgB).toContain(sciOrgB.id);
    expect(idsOrgB).not.toContain(bienOrgA.id);
    expect(idsOrgB).not.toContain(bailOrgA.id);
    expect(idsOrgB).not.toContain(sciOrgA.id);
  });
});
