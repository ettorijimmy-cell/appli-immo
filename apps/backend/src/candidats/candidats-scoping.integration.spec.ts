import { randomUUID } from "crypto";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  candidat,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  documents,
  locataires,
  organisations,
  utilisateurs,
  type Database
} from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuthModule } from "../auth/auth.module";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { LocatairesModule } from "../locataires/locataires.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { CandidatsModule } from "./candidats.module";
import { CandidatsService } from "./candidats.service";

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  candidatId: string;
  appartementId: string;
}

// Sous-commit 5a (chantier scoping multi-organisation, 2026-09-18) :
// CandidatsService.findById() ne vérifiait jusqu'ici jamais l'appartenance
// à l'organisation. organisationId est une colonne directe : contrôle par
// simple comparaison. Aucun autre appelant interne (vérifié par grep —
// seul CandidatsController.findOne l'appelle).
//
// convertirEnLocataire() refaisait sa propre requête brute sur candidatId,
// sans jamais appeler this.findById() — non protégée par ce sous-commit
// (Catégorie C, audit séparé). Corrigé en Priorité 2 (2026-09-19) via un
// helper privé partagé, resoudreCandidatAvecAppartenance() : voir le
// describe dédié plus bas dans ce fichier pour sa couverture cross-org.
// update()/archive() avaient la même lacune — corrigées en Priorité 3a
// (2026-09-19), même helper.
//
// create()/update() (Priorité E6a, chantier scoping multi-organisation,
// Catégorie E, 2026-09-19) : dto.appartementId (optionnel) n'était jamais
// vérifié — organisationId du candidat reste bien résolu depuis
// l'utilisateur (le candidat n'est jamais injecté chez un tiers), mais un
// appartementId étranger exposait des données patrimoniales d'une autre
// organisation dès qu'une vue résolvait ce champ pour l'affichage.
// Corrigé via verifierAppartenanceAppartement() (reproduit
// AppartementsService, privée et non réutilisable — CandidatsModule ne
// dépend pas d'AppartementsModule).
describe("CandidatsService — contrôle d'appartenance à l'organisation (create/findById/update/archive, intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let candidatsService: CandidatsService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Candidats Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `candidats-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `CandidatsScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }

    const bien = await bienService.create(user.id, {
      type: "maison",
      proprietaireType: "personne_physique",
      nomProprietaire: `Propriétaire ${suffixe}`,
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: suffixe,
      type: "T3",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });

    const candidat = await candidatsService.create(user.id, { nom: "Petit", prenom: `Julien${suffixe}` });

    return { organisationId: organisation.id, userId: user.id, candidatId: candidat.id, appartementId: appartement.id };
  }

  beforeEach(async () => {
    db = await begin();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        CommonModule,
        DatabaseModule,
        UsersModule,
        AuthModule,
        BienModule,
        AppartementsModule,
        LocatairesModule,
        CandidatsModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    candidatsService = moduleRef.get(CandidatsService);
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

  describe("create", () => {
    it("réussit normalement sans appartementId (champ optionnel, aucune vérification déclenchée)", async () => {
      const candidatCree = await contexteOrgA(() => candidatsService.create(orgA.userId, { nom: "Sans", prenom: "Appartement" }));
      expect(candidatCree.appartementId).toBeNull();
    });

    it("réussit normalement quand l'appartementId appartient à l'organisation appelante", async () => {
      const candidatCree = await contexteOrgA(() =>
        candidatsService.create(orgA.userId, { nom: "Avec", prenom: "Appartement", appartementId: orgA.appartementId })
      );
      expect(candidatCree.appartementId).toBe(orgA.appartementId);
    });

    it("404 sur l'appartementId d'une autre organisation, sans jamais créer de candidat", async () => {
      await expect(
        contexteOrgB(() =>
          candidatsService.create(orgB.userId, { nom: "Etranger", prenom: "Bob", appartementId: orgA.appartementId })
        )
      ).rejects.toThrow(NotFoundException);

      const lignes = await db.select().from(candidat).where(eq(candidat.appartementId, orgA.appartementId));
      expect(lignes).toHaveLength(0);
    });

    it("404 sur un appartementId inexistant", async () => {
      await expect(
        contexteOrgA(() => candidatsService.create(orgA.userId, { nom: "Fantôme", prenom: "X", appartementId: randomUUID() }))
      ).rejects.toThrow(NotFoundException);
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const candidatCree = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        candidatsService.create(orgA.userId, { nom: "SansContexte", prenom: "X", appartementId: orgB.appartementId })
      );
      expect(candidatCree.appartementId).toBe(orgB.appartementId);
    });
  });

  describe("findById", () => {
    it("réussit normalement quand le candidat appartient à l'organisation appelante", async () => {
      const candidatTrouve = await contexteOrgA(() => candidatsService.findById(orgA.candidatId));
      expect(candidatTrouve.id).toBe(orgA.candidatId);
    });

    it("404 sur le candidatId d'une autre organisation", async () => {
      await expect(contexteOrgB(() => candidatsService.findById(orgA.candidatId))).rejects.toThrow(
        NotFoundException
      );
    });

    it("404 sur un candidatId inexistant", async () => {
      await expect(contexteOrgA(() => candidatsService.findById(randomUUID()))).rejects.toThrow(NotFoundException);
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const candidatTrouve = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        candidatsService.findById(orgA.candidatId)
      );
      expect(candidatTrouve.id).toBe(orgA.candidatId);
    });
  });

  describe("update", () => {
    it("réussit normalement quand le candidat appartient à l'organisation appelante", async () => {
      const misAJour = await contexteOrgA(() => candidatsService.update(orgA.candidatId, { notes: "modifié" }));
      expect(misAJour.notes).toBe("modifié");
    });

    it("404 sur le candidatId d'une autre organisation, sans jamais modifier la ligne étrangère", async () => {
      await expect(
        contexteOrgB(() => candidatsService.update(orgA.candidatId, { notes: "modifié" }))
      ).rejects.toThrow(NotFoundException);
      const [inchange] = await db.select().from(candidat).where(eq(candidat.id, orgA.candidatId));
      expect(inchange?.notes).toBeNull();
    });

    it("404 sur un candidatId inexistant", async () => {
      await expect(contexteOrgA(() => candidatsService.update(randomUUID(), { notes: "modifié" }))).rejects.toThrow(
        NotFoundException
      );
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const misAJour = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        candidatsService.update(orgA.candidatId, { notes: "modifié" })
      );
      expect(misAJour.notes).toBe("modifié");
    });

    it("réussit normalement quand le nouvel appartementId appartient à l'organisation appelante", async () => {
      const misAJour = await contexteOrgA(() =>
        candidatsService.update(orgA.candidatId, { appartementId: orgA.appartementId })
      );
      expect(misAJour.appartementId).toBe(orgA.appartementId);
    });

    it("404 sur un appartementId d'une autre organisation, sans jamais modifier la ligne", async () => {
      await expect(
        contexteOrgA(() => candidatsService.update(orgA.candidatId, { appartementId: orgB.appartementId }))
      ).rejects.toThrow(NotFoundException);
      const [inchange] = await db.select().from(candidat).where(eq(candidat.id, orgA.candidatId));
      expect(inchange?.appartementId).toBeNull();
    });

    it("404 sur un appartementId inexistant", async () => {
      await expect(
        contexteOrgA(() => candidatsService.update(orgA.candidatId, { appartementId: randomUUID() }))
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("archive", () => {
    it("réussit normalement quand le candidat appartient à l'organisation appelante", async () => {
      const archive = await contexteOrgA(() => candidatsService.archive(orgA.candidatId));
      expect(archive.archivedAt).not.toBeNull();
    });

    it("404 sur le candidatId d'une autre organisation, sans jamais archiver la ligne étrangère", async () => {
      await expect(contexteOrgB(() => candidatsService.archive(orgA.candidatId))).rejects.toThrow(
        NotFoundException
      );
      const [inchange] = await db.select().from(candidat).where(eq(candidat.id, orgA.candidatId));
      expect(inchange?.archivedAt).toBeNull();
    });

    it("404 sur un candidatId inexistant", async () => {
      await expect(contexteOrgA(() => candidatsService.archive(randomUUID()))).rejects.toThrow(NotFoundException);
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const archive = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        candidatsService.archive(orgA.candidatId)
      );
      expect(archive.archivedAt).not.toBeNull();
    });
  });
});

// Priorité 2 (chantier scoping multi-organisation, Catégorie C, 2026-09-19) :
// convertirEnLocataire() créait un vrai locataire à partir des données du
// candidat, et réattribuait ses documents (entiteType/entiteId réécrits),
// sans jamais vérifier l'organisation appelante — le cas de divulgation ET
// intégrité combinées le plus sévère de l'audit Catégorie C après ceux de
// TachesService. Corrigé via resoudreCandidatAvecAppartenance(), le même
// helper privé que findById() ci-dessus.
describe("CandidatsService.convertirEnLocataire — contrôle d'appartenance (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let candidatsService: CandidatsService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Candidats Conversion Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `candidats-conversion-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `CandidatsConversionScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }

    const candidatCree = await candidatsService.create(user.id, {
      nom: "Petit",
      prenom: `Julien${suffixe}`,
      telephone: "0600000000",
      email: `julien.petit.${suffixe}@example.com`
    });

    return { organisationId: organisation.id, userId: user.id, candidatId: candidatCree.id };
  }

  beforeEach(async () => {
    db = await begin();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        CommonModule,
        DatabaseModule,
        UsersModule,
        AuthModule,
        LocatairesModule,
        CandidatsModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    candidatsService = moduleRef.get(CandidatsService);
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

  it("convertit normalement quand le candidat appartient à l'organisation appelante", async () => {
    const resultat = await contexteOrgA(() => candidatsService.convertirEnLocataire(orgA.userId, orgA.candidatId));
    expect(resultat.candidat.statut).toBe("converti");
    expect(resultat.locataire.nom).toBe("Petit");
  });

  it("404 sur le candidatId d'une autre organisation, sans jamais créer de locataire ni réattribuer de documents", async () => {
    const [documentCandidat] = await db
      .insert(documents)
      .values({
        entiteType: "candidat",
        entiteId: orgA.candidatId,
        candidatRole: "candidat",
        categorie: "piece_identite",
        nomFichier: "cni-candidat.pdf",
        mimeType: "application/pdf",
        tailleOctets: 1,
        cheminStockage: `test/${randomUUID()}.enc`
      })
      .returning();
    if (!documentCandidat) {
      throw new Error("Échec de l'insertion du document de test");
    }
    const locatairesOrgBAvant = await db.select().from(locataires).where(eq(locataires.organisationId, orgB.organisationId));

    await expect(
      contexteOrgB(() => candidatsService.convertirEnLocataire(orgB.userId, orgA.candidatId))
    ).rejects.toThrow(NotFoundException);

    const locatairesOrgBApres = await db.select().from(locataires).where(eq(locataires.organisationId, orgB.organisationId));
    expect(locatairesOrgBApres).toHaveLength(locatairesOrgBAvant.length);

    const [documentInchange] = await db.select().from(documents).where(eq(documents.id, documentCandidat.id));
    expect(documentInchange?.entiteType).toBe("candidat");
    expect(documentInchange?.entiteId).toBe(orgA.candidatId);
    expect(documentInchange?.candidatRole).toBe("candidat");

    const [candidatInchange] = await db.select().from(candidat).where(eq(candidat.id, orgA.candidatId));
    expect(candidatInchange?.statut).not.toBe("converti");
  });

  it("404 sur un candidatId inexistant", async () => {
    await expect(
      contexteOrgA(() => candidatsService.convertirEnLocataire(orgA.userId, randomUUID()))
    ).rejects.toThrow(NotFoundException);
  });

  it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
    const resultat = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
      candidatsService.convertirEnLocataire(orgA.userId, orgA.candidatId)
    );
    expect(resultat.candidat.statut).toBe("converti");
  });
});
