import { randomUUID } from "crypto";
import { rm } from "fs/promises";
import os from "os";
import path from "path";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, documents, immeublesLegacy, organisations, utilisateurs, type Database } from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuditModule } from "../audit/audit.module";
import { AuditService } from "../audit/audit.service";
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
import { DocumentStorageService } from "../storage/document-storage.service";
import { StorageModule } from "../storage/storage.module";
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
  let auditService: AuditService;
  let documentStorageService: DocumentStorageService;

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
        StorageModule,
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
    auditService = moduleRef.get(AuditService);
    documentStorageService = moduleRef.get(DocumentStorageService);

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
    await rm(storageDirTest, { recursive: true, force: true });
  });

  // Upload hors contexte HTTP (comme le beforeEach) : verifierEntiteExiste()
  // vérifie désormais aussi l'organisation (Priorité E5, voir describe
  // "upload / creerDepuisBuffer" plus bas), mais son contrôle est skip hors
  // contexte HTTP (comportement préexistant préservé) — les deux
  // organisations peuvent donc toujours uploader librement pendant la
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

  // Priorité E5 (chantier scoping multi-organisation, Catégorie E,
  // 2026-09-19) : verifierEntiteExiste() (appelée par creerDepuisBuffer(),
  // donc par upload() ET par
  // MessagesCommunicationService.classerDansDocuments() en aval) ne
  // vérifiait jusqu'ici que l'existence de dto.entiteId, jamais son
  // appartenance à l'organisation appelante — un entiteId étranger menait à
  // écrire le blob chiffré sur disque PUIS à insérer une ligne documents
  // rattachée à cette entité étrangère. Corrigé en réutilisant
  // resoudreEntiteIdsOrganisation (Sous-commit 4c), même principe que
  // telecharger()/findById() ci-dessous. storage.enregistrer doit rester
  // non appelé sur le chemin refusé (aucun blob écrit), et aucune ligne
  // documents insérée. Trois entiteType couverts (mêmes chemins que le
  // describe findById ci-dessous) : 'sci' (via organisation_sci),
  // 'appartement' (jointure simple vers bien), 'locataire' (colonne
  // organisationId directe) — ce correctif ferme aussi, sans aucun
  // changement dans messages-communication.service.ts, le volet
  // entiteType/entiteId de classerDansDocuments() resté ouvert depuis la
  // Priorité 2 (voir messages-communication-scoping.integration.spec.ts
  // pour la preuve dédiée à ce chemin précis).
  describe("upload / creerDepuisBuffer — contrôle d'appartenance", () => {
    it("entiteType='sci' (via organisation_sci) : succès même organisation, 404 cross-org sans écriture", async () => {
      const document = await requestContextService.executerAvecContexte(
        { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
        () => documentsService.upload({ entiteType: "sci", entiteId: orgA.sciId, categorie: "photo" }, fichierTest("x", "x.pdf"))
      );
      expect(document.entiteId).toBe(orgA.sciId);

      const enregistrerSpy = vi.spyOn(documentStorageService, "enregistrer");
      await expect(
        requestContextService.executerAvecContexte(
          { utilisateurId: orgB.userId, organisationId: orgB.organisationId },
          () => documentsService.upload({ entiteType: "sci", entiteId: orgA.sciId, categorie: "photo" }, fichierTest("x", "x.pdf"))
        )
      ).rejects.toThrow(NotFoundException);
      expect(enregistrerSpy).not.toHaveBeenCalled();
      const lignes = await db.select().from(documents).where(eq(documents.entiteId, orgA.sciId));
      expect(lignes).toHaveLength(1);
      expect(lignes[0]?.id).toBe(document.id);
    });

    it("entiteType='appartement' (jointure simple vers bien) : succès même organisation, 404 cross-org sans écriture", async () => {
      const document = await requestContextService.executerAvecContexte(
        { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
        () =>
          documentsService.upload(
            { entiteType: "appartement", entiteId: orgA.appartementId, categorie: "photo" },
            fichierTest("x", "x.pdf")
          )
      );
      expect(document.entiteId).toBe(orgA.appartementId);

      const enregistrerSpy = vi.spyOn(documentStorageService, "enregistrer");
      await expect(
        requestContextService.executerAvecContexte(
          { utilisateurId: orgB.userId, organisationId: orgB.organisationId },
          () =>
            documentsService.upload(
              { entiteType: "appartement", entiteId: orgA.appartementId, categorie: "photo" },
              fichierTest("x", "x.pdf")
            )
        )
      ).rejects.toThrow(NotFoundException);
      expect(enregistrerSpy).not.toHaveBeenCalled();
      const lignes = await db.select().from(documents).where(eq(documents.entiteId, orgA.appartementId));
      expect(lignes).toHaveLength(1);
      expect(lignes[0]?.id).toBe(document.id);
    });

    it("entiteType='locataire' (colonne organisationId directe) : succès même organisation, 404 cross-org sans écriture", async () => {
      const document = await requestContextService.executerAvecContexte(
        { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
        () =>
          documentsService.upload(
            { entiteType: "locataire", entiteId: orgA.locataireId, categorie: "photo" },
            fichierTest("x", "x.pdf")
          )
      );
      expect(document.entiteId).toBe(orgA.locataireId);

      const enregistrerSpy = vi.spyOn(documentStorageService, "enregistrer");
      await expect(
        requestContextService.executerAvecContexte(
          { utilisateurId: orgB.userId, organisationId: orgB.organisationId },
          () =>
            documentsService.upload(
              { entiteType: "locataire", entiteId: orgA.locataireId, categorie: "photo" },
              fichierTest("x", "x.pdf")
            )
        )
      ).rejects.toThrow(NotFoundException);
      expect(enregistrerSpy).not.toHaveBeenCalled();
      const lignes = await db.select().from(documents).where(eq(documents.entiteId, orgA.locataireId));
      expect(lignes).toHaveLength(1);
      expect(lignes[0]?.id).toBe(document.id);
    });

    it("404 sur un entiteId inexistant, sans jamais écrire de blob", async () => {
      const enregistrerSpy = vi.spyOn(documentStorageService, "enregistrer");

      await expect(
        requestContextService.executerAvecContexte(
          { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
          () => documentsService.upload({ entiteType: "bien", entiteId: randomUUID(), categorie: "photo" }, fichierTest("x", "x.pdf"))
        )
      ).rejects.toThrow(NotFoundException);

      expect(enregistrerSpy).not.toHaveBeenCalled();
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const document = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        documentsService.upload({ entiteType: "bien", entiteId: orgB.bienId, categorie: "photo" }, fichierTest("x", "x.pdf"))
      );
      expect(document.entiteId).toBe(orgB.bienId);
    });
  });

  // Commit B4 (chantier scoping multi-organisation, 2026-09-18) :
  // telecharger(id) refaisait sa propre requête SQL et déchiffrait le
  // contenu sans aucun contrôle d'appartenance — corrigé en réutilisant
  // resoudreEntiteIdsOrganisation (Sous-commit 4c). storage.lire et
  // logAccesDocumentSensible (via logAccesDonneeSensible) doivent rester
  // non appelés sur le chemin refusé, pas seulement produire un 404.
  describe("telecharger — contrôle d'appartenance", () => {
    it("télécharge normalement le contenu quand le document appartient à l'organisation appelante", async () => {
      const { documentOrgA } = await uploaderPourLesDeuxOrganisations("bien", orgA.bienId, orgB.bienId);

      const resultat = await requestContextService.executerAvecContexte(
        { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
        () => documentsService.telecharger(documentOrgA.id)
      );
      expect(resultat.contenu.toString("utf8")).toBe("contenu-bien-A");
    });

    it("404 sur le document d'une autre organisation, sans jamais déchiffrer ni journaliser", async () => {
      const { documentOrgA } = await uploaderPourLesDeuxOrganisations("bien", orgA.bienId, orgB.bienId);
      const lireSpy = vi.spyOn(documentStorageService, "lire");
      const auditSpy = vi.spyOn(auditService, "logAccesDonneeSensible");

      await expect(
        requestContextService.executerAvecContexte(
          { utilisateurId: orgB.userId, organisationId: orgB.organisationId },
          () => documentsService.telecharger(documentOrgA.id)
        )
      ).rejects.toThrow(NotFoundException);

      expect(lireSpy).not.toHaveBeenCalled();
      expect(auditSpy).not.toHaveBeenCalled();
    });

    it("404 sur un id inexistant, sans jamais déchiffrer", async () => {
      const lireSpy = vi.spyOn(documentStorageService, "lire");

      await expect(
        requestContextService.executerAvecContexte(
          { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
          () => documentsService.telecharger(randomUUID())
        )
      ).rejects.toThrow(NotFoundException);

      expect(lireSpy).not.toHaveBeenCalled();
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const { documentOrgA } = await uploaderPourLesDeuxOrganisations("bien", orgA.bienId, orgB.bienId);

      const resultat = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        documentsService.telecharger(documentOrgA.id)
      );
      expect(resultat.contenu.toString("utf8")).toBe("contenu-bien-A");
    });
  });

  // Sous-commit 5d (chantier scoping multi-organisation, 2026-09-18) :
  // findById(id) renvoyait n'importe quel document sans jamais vérifier
  // l'organisation appelante — corrigé en réutilisant
  // resoudreEntiteIdsOrganisation (Sous-commit 4c), même principe que
  // telecharger() (commit B4). Trois entiteType couverts pour prouver que
  // la résolution polymorphe fonctionne correctement dans ce nouveau
  // contexte : 'sci' (via organisation_sci), 'appartement' (jointure
  // simple vers bien), 'locataire' (colonne organisationId directe) —
  // les 8 autres chemins sont déjà couverts pour findAll() plus haut dans
  // ce fichier et partagent la même fonction de résolution.
  describe("findById — contrôle d'appartenance", () => {
    it("entiteType='sci' (via organisation_sci) : succès même organisation, 404 cross-org", async () => {
      const { documentOrgA } = await uploaderPourLesDeuxOrganisations("sci", orgA.sciId, orgB.sciId);

      const trouve = await requestContextService.executerAvecContexte(
        { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
        () => documentsService.findById(documentOrgA.id)
      );
      expect(trouve.id).toBe(documentOrgA.id);

      await expect(
        requestContextService.executerAvecContexte(
          { utilisateurId: orgB.userId, organisationId: orgB.organisationId },
          () => documentsService.findById(documentOrgA.id)
        )
      ).rejects.toThrow(NotFoundException);
    });

    it("entiteType='appartement' (jointure simple vers bien) : succès même organisation, 404 cross-org", async () => {
      const { documentOrgA } = await uploaderPourLesDeuxOrganisations(
        "appartement",
        orgA.appartementId,
        orgB.appartementId
      );

      const trouve = await requestContextService.executerAvecContexte(
        { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
        () => documentsService.findById(documentOrgA.id)
      );
      expect(trouve.id).toBe(documentOrgA.id);

      await expect(
        requestContextService.executerAvecContexte(
          { utilisateurId: orgB.userId, organisationId: orgB.organisationId },
          () => documentsService.findById(documentOrgA.id)
        )
      ).rejects.toThrow(NotFoundException);
    });

    it("entiteType='locataire' (colonne organisationId directe) : succès même organisation, 404 cross-org", async () => {
      const { documentOrgA } = await uploaderPourLesDeuxOrganisations(
        "locataire",
        orgA.locataireId,
        orgB.locataireId
      );

      const trouve = await requestContextService.executerAvecContexte(
        { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
        () => documentsService.findById(documentOrgA.id)
      );
      expect(trouve.id).toBe(documentOrgA.id);

      await expect(
        requestContextService.executerAvecContexte(
          { utilisateurId: orgB.userId, organisationId: orgB.organisationId },
          () => documentsService.findById(documentOrgA.id)
        )
      ).rejects.toThrow(NotFoundException);
    });

    it("404 sur un id inexistant", async () => {
      await expect(
        requestContextService.executerAvecContexte(
          { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
          () => documentsService.findById(randomUUID())
        )
      ).rejects.toThrow(NotFoundException);
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const { documentOrgA } = await uploaderPourLesDeuxOrganisations("bien", orgA.bienId, orgB.bienId);

      const trouve = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        documentsService.findById(documentOrgA.id)
      );
      expect(trouve.id).toBe(documentOrgA.id);
    });
  });

  // Priorité 2 (chantier scoping multi-organisation, Catégorie C,
  // 2026-09-19) : remplacerDocument() créait une nouvelle version chaînée à
  // documentPrecedentId et archivait l'ancienne sans jamais vérifier
  // l'organisation appelante — corrigé en réutilisant
  // resoudreEntiteIdsOrganisation (Sous-commit 4c), même principe que
  // findById()/telecharger(). storage.enregistrer doit rester non appelé sur
  // le chemin refusé (aucun blob écrit), et le document original doit rester
  // inchangé (aucune nouvelle version chaînée, archivedAt/statut intacts).
  describe("remplacerDocument — contrôle d'appartenance", () => {
    it("remplace normalement quand le document précédent appartient à l'organisation appelante", async () => {
      const { documentOrgA } = await uploaderPourLesDeuxOrganisations("bien", orgA.bienId, orgB.bienId);

      const nouveau = await requestContextService.executerAvecContexte(
        { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
        () =>
          documentsService.remplacerDocument(
            documentOrgA.id,
            { categorie: "photo" },
            fichierTest("nouveau-contenu-A", "nouveau-A.pdf")
          )
      );
      expect(nouveau.documentPrecedentId).toBe(documentOrgA.id);
    });

    it("404 sur le documentPrecedentId d'une autre organisation, sans jamais écrire de blob ni créer/modifier de ligne", async () => {
      const { documentOrgA } = await uploaderPourLesDeuxOrganisations("bien", orgA.bienId, orgB.bienId);
      const enregistrerSpy = vi.spyOn(documentStorageService, "enregistrer");

      await expect(
        requestContextService.executerAvecContexte(
          { utilisateurId: orgB.userId, organisationId: orgB.organisationId },
          () =>
            documentsService.remplacerDocument(
              documentOrgA.id,
              { categorie: "photo" },
              fichierTest("tentative-cross-org", "cross-org.pdf")
            )
        )
      ).rejects.toThrow(NotFoundException);

      expect(enregistrerSpy).not.toHaveBeenCalled();

      const nouvellesVersions = await db.select().from(documents).where(eq(documents.documentPrecedentId, documentOrgA.id));
      expect(nouvellesVersions).toHaveLength(0);

      const [ancienInchange] = await db.select().from(documents).where(eq(documents.id, documentOrgA.id));
      expect(ancienInchange?.archivedAt).toBeNull();
      expect(ancienInchange?.statut).toBe("valide");
    });

    it("404 sur un documentPrecedentId inexistant, sans jamais écrire de blob", async () => {
      const enregistrerSpy = vi.spyOn(documentStorageService, "enregistrer");

      await expect(
        requestContextService.executerAvecContexte(
          { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
          () => documentsService.remplacerDocument(randomUUID(), { categorie: "photo" }, fichierTest("x", "x.pdf"))
        )
      ).rejects.toThrow(NotFoundException);

      expect(enregistrerSpy).not.toHaveBeenCalled();
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const { documentOrgA } = await uploaderPourLesDeuxOrganisations("bien", orgA.bienId, orgB.bienId);

      const nouveau = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        documentsService.remplacerDocument(
          documentOrgA.id,
          { categorie: "photo" },
          fichierTest("nouveau-contenu-hors-contexte", "hc.pdf")
        )
      );
      expect(nouveau.documentPrecedentId).toBe(documentOrgA.id);
    });
  });

  // Priorité 3b (chantier scoping multi-organisation, Catégorie C,
  // 2026-09-19) : update()/archiver() n'étaient pas protégées par le
  // Sous-commit 5d (Catégorie C, audit séparé) — corrigées via
  // resoudreDocumentAvecAppartenance(), extrait de findById() et désormais
  // partagé par les trois.
  describe("update — contrôle d'appartenance", () => {
    it("met à jour normalement quand le document appartient à l'organisation appelante", async () => {
      const { documentOrgA } = await uploaderPourLesDeuxOrganisations("bien", orgA.bienId, orgB.bienId);

      const misAJour = await requestContextService.executerAvecContexte(
        { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
        () => documentsService.update(documentOrgA.id, { categorie: "assurance" })
      );
      expect(misAJour.categorie).toBe("assurance");
    });

    it("404 sur le documentId d'une autre organisation, sans jamais modifier la ligne étrangère", async () => {
      const { documentOrgA } = await uploaderPourLesDeuxOrganisations("bien", orgA.bienId, orgB.bienId);

      await expect(
        requestContextService.executerAvecContexte(
          { utilisateurId: orgB.userId, organisationId: orgB.organisationId },
          () => documentsService.update(documentOrgA.id, { categorie: "assurance" })
        )
      ).rejects.toThrow(NotFoundException);

      const [inchange] = await db.select().from(documents).where(eq(documents.id, documentOrgA.id));
      expect(inchange?.categorie).toBe("photo");
    });

    it("404 sur un documentId inexistant", async () => {
      await expect(
        requestContextService.executerAvecContexte(
          { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
          () => documentsService.update(randomUUID(), { categorie: "assurance" })
        )
      ).rejects.toThrow(NotFoundException);
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const { documentOrgA } = await uploaderPourLesDeuxOrganisations("bien", orgA.bienId, orgB.bienId);

      const misAJour = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        documentsService.update(documentOrgA.id, { categorie: "assurance" })
      );
      expect(misAJour.categorie).toBe("assurance");
    });
  });

  describe("archiver — contrôle d'appartenance", () => {
    it("archive normalement quand le document appartient à l'organisation appelante", async () => {
      const { documentOrgA } = await uploaderPourLesDeuxOrganisations("bien", orgA.bienId, orgB.bienId);

      const archive = await requestContextService.executerAvecContexte(
        { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
        () => documentsService.archiver(documentOrgA.id)
      );
      expect(archive.archivedAt).not.toBeNull();
    });

    it("404 sur le documentId d'une autre organisation, sans jamais archiver la ligne étrangère", async () => {
      const { documentOrgA } = await uploaderPourLesDeuxOrganisations("bien", orgA.bienId, orgB.bienId);

      await expect(
        requestContextService.executerAvecContexte(
          { utilisateurId: orgB.userId, organisationId: orgB.organisationId },
          () => documentsService.archiver(documentOrgA.id)
        )
      ).rejects.toThrow(NotFoundException);

      const [inchange] = await db.select().from(documents).where(eq(documents.id, documentOrgA.id));
      expect(inchange?.archivedAt).toBeNull();
      expect(inchange?.statut).not.toBe("archive");
    });

    it("404 sur un documentId inexistant", async () => {
      await expect(
        requestContextService.executerAvecContexte(
          { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
          () => documentsService.archiver(randomUUID())
        )
      ).rejects.toThrow(NotFoundException);
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const { documentOrgA } = await uploaderPourLesDeuxOrganisations("bien", orgA.bienId, orgB.bienId);

      const archive = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        documentsService.archiver(documentOrgA.id)
      );
      expect(archive.archivedAt).not.toBeNull();
    });
  });
});
