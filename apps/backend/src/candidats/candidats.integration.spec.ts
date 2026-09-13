import { randomUUID } from "crypto";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { candidat, createDbClient, DEFAULT_DEV_DATABASE_URL, documents, organisations, utilisateurs, type Database } from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { CandidatsModule } from "./candidats.module";
import { CandidatsService } from "./candidats.service";

// Module Calendrier/Candidats (2026-09-15) : candidat locataire, module
// séparé du Calendrier (anticipation du futur portail externe de dépôt de
// dossier, docs/backlog.md, "Portail externe"). Chaque test tourne dans sa
// propre transaction annulée dans afterEach (test-utils/transactional-test.ts).
describe("CandidatsService (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let candidatsService: CandidatsService;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
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
        UsersModule,
        ScisModule,
        BienModule,
        AppartementsModule,
        CandidatsModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    candidatsService = moduleRef.get(CandidatsService);
    scisService = moduleRef.get(ScisService);
    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    requestContextService = moduleRef.get(RequestContextService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Candidats Intégration" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    organisationId = organisation.id;

    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `candidats-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Candidats",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    userId = user.id;

    const sci = await scisService.create(userId, {
      nom: "SCI Candidats Test",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Candidats Test",
      adresse: "1 rue des Candidats",
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

  it("crée un candidat rattaché à un appartement, statut en_attente par défaut", async () => {
    const candidat = await candidatsService.create(userId, {
      nom: "Martin",
      prenom: "Sophie",
      appartementId,
      telephone: "0600000000",
      email: "sophie.martin@example.com",
      revenuMensuelNet: "1800",
      loyerVise: "800"
    });

    expect(candidat.nom).toBe("Martin");
    expect(candidat.prenom).toBe("Sophie");
    expect(candidat.statut).toBe("en_attente");
    expect(candidat.appartementId).toBe(appartementId);
    expect(candidat.revenuMensuelNet).toBe("1800.00");
    expect(candidat.loyerVise).toBe("800.00");
  });

  it("crée un candidat sans appartement ni informations financières (données incomplètes)", async () => {
    const candidat = await candidatsService.create(userId, { nom: "Dossier", prenom: "Incomplet" });
    expect(candidat.appartementId).toBeNull();
    expect(candidat.revenuMensuelNet).toBeNull();
  });

  it("met à jour le statut d'un candidat (en_attente -> valide)", async () => {
    const candidat = await candidatsService.create(userId, { nom: "Martin", prenom: "Sophie", appartementId });
    const misAJour = await candidatsService.update(candidat.id, { statut: "valide" });
    expect(misAJour.statut).toBe("valide");
  });

  it("archive un candidat sans le supprimer physiquement", async () => {
    const candidat = await candidatsService.create(userId, { nom: "À", prenom: "Archiver" });
    const archive = await candidatsService.archive(candidat.id);
    expect(archive.archivedAt).not.toBeNull();

    const relu = await candidatsService.findById(candidat.id);
    expect(relu).not.toBeNull();
    expect(relu?.archivedAt).not.toBeNull();
  });

  it("findAll scope par organisation", async () => {
    const [autreOrganisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Autre Organisation Candidats" })
      .returning();
    if (!autreOrganisation) {
      throw new Error("Échec de l'insertion de l'autre organisation de test");
    }
    const [autreUser] = await db
      .insert(utilisateurs)
      .values({
        organisationId: autreOrganisation.id,
        email: `autre-org-candidats-${randomUUID()}@example.com`,
        nom: "Autre",
        prenom: "OrgCandidats",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!autreUser) {
      throw new Error("Échec de l'insertion de l'autre utilisateur de test");
    }

    const candidatOrgA = await candidatsService.create(userId, { nom: "Candidat", prenom: "A" });
    const candidatOrgB = await candidatsService.create(autreUser.id, { nom: "Candidat", prenom: "B" });

    const listeOrgA = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      candidatsService.findAll()
    );
    expect(listeOrgA.map((c) => c.id)).toContain(candidatOrgA.id);
    expect(listeOrgA.map((c) => c.id)).not.toContain(candidatOrgB.id);
  });

  // Extension checklist candidat (2026-09-15) : "Convertir en locataire" ne
  // génère JAMAIS de bail (dates/loyer réel absents du dossier candidat, ce
  // serait les deviner) — la création du bail reste un geste séparé via
  // l'écran Patrimoine existant. nom/prenom sont copiés directement depuis
  // le candidat (prenom séparé de nom exactement pour permettre cette copie
  // directe, jamais de ressaisie ni de découpage heuristique).
  describe("convertirEnLocataire", () => {
    it("crée un locataire depuis nom/prenom/telephone/email du candidat, et passe le candidat à 'converti', sans générer de bail", async () => {
      const candidatTest = await candidatsService.create(userId, {
        nom: "Martin",
        prenom: "Sophie",
        telephone: "0600000000",
        email: "sophie.martin@example.com"
      });

      const resultat = await candidatsService.convertirEnLocataire(userId, candidatTest.id);

      expect(resultat.locataire.nom).toBe("Martin");
      expect(resultat.locataire.prenom).toBe("Sophie");
      expect(resultat.locataire.telephone).toBe("0600000000");
      expect(resultat.locataire.email).toBe("sophie.martin@example.com");
      expect(resultat.candidat.statut).toBe("converti");

      const relu = await candidatsService.findById(candidatTest.id);
      expect(relu?.statut).toBe("converti");
    });

    it("rejette la conversion si le prénom du candidat n'est pas renseigné", async () => {
      // Insertion directe (pas via candidatsService.create(), qui exige
      // prenom) — simule un candidat créé avant l'ajout de cette colonne.
      const [candidatSansPrenom] = await db.insert(candidat).values({ nom: "Sans Prenom", organisationId }).returning();
      if (!candidatSansPrenom) {
        throw new Error("Échec de l'insertion du candidat de test");
      }

      await expect(candidatsService.convertirEnLocataire(userId, candidatSansPrenom.id)).rejects.toThrow();
    });

    it("rejette la conversion d'un candidat déjà converti", async () => {
      const candidatTest = await candidatsService.create(userId, { nom: "Déjà", prenom: "Converti" });
      await candidatsService.convertirEnLocataire(userId, candidatTest.id);

      await expect(candidatsService.convertirEnLocataire(userId, candidatTest.id)).rejects.toThrow();
    });

    it("rejette la conversion d'un candidat inexistant", async () => {
      await expect(candidatsService.convertirEnLocataire(userId, randomUUID())).rejects.toThrow();
    });

    it("rattache les documents du candidat (candidatRole='candidat') au nouveau locataire, laisse ceux du garant sur le candidat", async () => {
      const candidatTest = await candidatsService.create(userId, { nom: "Avec", prenom: "Documents" });

      const [documentCandidat] = await db
        .insert(documents)
        .values({
          entiteType: "candidat",
          entiteId: candidatTest.id,
          candidatRole: "candidat",
          categorie: "piece_identite",
          nomFichier: "cni-candidat.pdf",
          mimeType: "application/pdf",
          tailleOctets: 1,
          cheminStockage: `test/${randomUUID()}.enc`
        })
        .returning();
      const [documentGarant] = await db
        .insert(documents)
        .values({
          entiteType: "candidat",
          entiteId: candidatTest.id,
          candidatRole: "garant",
          categorie: "piece_identite",
          nomFichier: "cni-garant.pdf",
          mimeType: "application/pdf",
          tailleOctets: 1,
          cheminStockage: `test/${randomUUID()}.enc`
        })
        .returning();
      if (!documentCandidat || !documentGarant) {
        throw new Error("Échec de l'insertion des documents de test");
      }

      const resultat = await candidatsService.convertirEnLocataire(userId, candidatTest.id);

      const [documentCandidatApres] = await db.select().from(documents).where(eq(documents.id, documentCandidat.id));
      expect(documentCandidatApres?.entiteType).toBe("locataire");
      expect(documentCandidatApres?.entiteId).toBe(resultat.locataire.id);
      expect(documentCandidatApres?.candidatRole).toBeNull();

      const [documentGarantApres] = await db.select().from(documents).where(eq(documents.id, documentGarant.id));
      expect(documentGarantApres?.entiteType).toBe("candidat");
      expect(documentGarantApres?.entiteId).toBe(candidatTest.id);
      expect(documentGarantApres?.candidatRole).toBe("garant");
    });
  });
});
