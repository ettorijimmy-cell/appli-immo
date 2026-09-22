import { randomUUID } from "crypto";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, sinistre, utilisateurs, type Database } from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuthModule } from "../auth/auth.module";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { ContactsModule } from "../contacts/contacts.module";
import { ContactsService } from "../contacts/contacts.service";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { SinistresModule } from "./sinistres.module";
import { SinistresService } from "./sinistres.service";

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  sinistreId: string;
}

// Sous-commit 5a (chantier scoping multi-organisation, 2026-09-18) :
// SinistresService.findById() ne vérifiait jusqu'ici jamais l'appartenance
// à l'organisation. organisationId est une colonne directe : contrôle par
// simple comparaison. Aucun autre appelant interne (vérifié par grep —
// seul SinistresController.findOne l'appelle).
//
// update()/archive() n'étaient pas protégées par ce sous-commit (Catégorie
// C, audit séparé) — corrigées en Priorité 3a (2026-09-19) via
// resoudreSinistreAvecAppartenance(), le même helper privé que findById()
// (aucun appelant interne, seul SinistresController).
describe("SinistresService — contrôle d'appartenance à l'organisation (findById/update/archive, intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let sinistresService: SinistresService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Sinistres Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `sinistres-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `SinistresScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }

    const sinistre = await sinistresService.create(user.id, {
      type: "degat_eaux",
      dateDeclaration: "2026-08-15"
    });

    return { organisationId: organisation.id, userId: user.id, sinistreId: sinistre.id };
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
        SinistresModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    sinistresService = moduleRef.get(SinistresService);
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

  describe("findById", () => {
    it("réussit normalement quand le sinistre appartient à l'organisation appelante", async () => {
      const sinistreTrouve = await contexteOrgA(() => sinistresService.findById(orgA.sinistreId));
      expect(sinistreTrouve.id).toBe(orgA.sinistreId);
    });

    it("404 sur le sinistreId d'une autre organisation", async () => {
      await expect(contexteOrgB(() => sinistresService.findById(orgA.sinistreId))).rejects.toThrow(
        NotFoundException
      );
    });

    it("404 sur un sinistreId inexistant", async () => {
      await expect(contexteOrgA(() => sinistresService.findById(randomUUID()))).rejects.toThrow(NotFoundException);
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const sinistreTrouve = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        sinistresService.findById(orgA.sinistreId)
      );
      expect(sinistreTrouve.id).toBe(orgA.sinistreId);
    });
  });

  describe("update", () => {
    it("réussit normalement quand le sinistre appartient à l'organisation appelante", async () => {
      const misAJour = await contexteOrgA(() =>
        sinistresService.update(orgA.sinistreId, { description: "modifié" })
      );
      expect(misAJour.description).toBe("modifié");
    });

    it("404 sur le sinistreId d'une autre organisation, sans jamais modifier la ligne étrangère", async () => {
      await expect(
        contexteOrgB(() => sinistresService.update(orgA.sinistreId, { description: "modifié" }))
      ).rejects.toThrow(NotFoundException);
      const [inchange] = await db.select().from(sinistre).where(eq(sinistre.id, orgA.sinistreId));
      expect(inchange?.description).toBeNull();
    });

    it("404 sur un sinistreId inexistant", async () => {
      await expect(
        contexteOrgA(() => sinistresService.update(randomUUID(), { description: "modifié" }))
      ).rejects.toThrow(NotFoundException);
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const misAJour = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        sinistresService.update(orgA.sinistreId, { description: "modifié" })
      );
      expect(misAJour.description).toBe("modifié");
    });
  });

  describe("archive", () => {
    it("réussit normalement quand le sinistre appartient à l'organisation appelante", async () => {
      const archive = await contexteOrgA(() => sinistresService.archive(orgA.sinistreId));
      expect(archive.archivedAt).not.toBeNull();
    });

    it("404 sur le sinistreId d'une autre organisation, sans jamais archiver la ligne étrangère", async () => {
      await expect(contexteOrgB(() => sinistresService.archive(orgA.sinistreId))).rejects.toThrow(
        NotFoundException
      );
      const [inchange] = await db.select().from(sinistre).where(eq(sinistre.id, orgA.sinistreId));
      expect(inchange?.archivedAt).toBeNull();
    });

    it("404 sur un sinistreId inexistant", async () => {
      await expect(contexteOrgA(() => sinistresService.archive(randomUUID()))).rejects.toThrow(NotFoundException);
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const archive = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        sinistresService.archive(orgA.sinistreId)
      );
      expect(archive.archivedAt).not.toBeNull();
    });
  });
});

interface FixtureOrganisationRattachements {
  organisationId: string;
  userId: string;
  bienId: string;
  appartementId: string;
  contactId: string;
}

// Priorité E6d (chantier scoping multi-organisation, Catégorie E,
// 2026-09-19) — dernier sous-commit de la Priorité E : bienId/
// appartementId/contactAssureurId étaient écrits tels quels dans sinistre,
// sans jamais vérifier que l'entité rattachée appartient à l'organisation
// de l'appelant. sinistre.organisationId reste bien résolu depuis
// l'utilisateur (le sinistre n'est jamais injecté chez un tiers), mais un
// id étranger sur l'un de ces 3 champs exposait des données d'une autre
// organisation dès qu'une vue résolvait ce champ pour l'affichage (adresse
// du bien, nom/coordonnées du contact assureur). Corrigé via
// verifierAppartenancesSinistre() : bien et contact ont une colonne
// organisationId directe (comparaison simple) ; appartements n'en a pas,
// jointure via bien requise (même limitation que
// CandidatsService.verifierAppartenanceAppartement/
// EvenementsCalendrierService.verifierAppartenanceAppartement, E6a/E6c).
// Aucun helper findById() des 3 services propriétaires réutilisable
// (privés, et SinistresModule ne dépend que de UsersModule) : reproduit
// directement, même pattern qu'E1-E6c. Vérifié (grep) : ni
// AlertesJobService.genererAlertesSinistreStagnation ni
// TachesJobService/TachesService (résolution du contact assureur pour la
// relance) n'appellent SinistresService.create()/update() — tous lisent la
// table sinistre directement — donc aucun impact sur le mécanisme
// d'alerte/relance.
describe("SinistresService.create/update — contrôle d'appartenance sur bienId/appartementId/contactAssureurId (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let contactsService: ContactsService;
  let sinistresService: SinistresService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisationRattachements;
  let orgB: FixtureOrganisationRattachements;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisationRattachements> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Sinistres Rattachements ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `sinistres-rattachements-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `SinistresRattachements${suffixe}`,
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
    const contact = await contactsService.create(user.id, {
      nom: `Assureur ${suffixe}`,
      typeEntite: "entreprise",
      role: "assureur"
    });

    return {
      organisationId: organisation.id,
      userId: user.id,
      bienId: bien.id,
      appartementId: appartement.id,
      contactId: contact.id
    };
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
        ContactsModule,
        SinistresModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    contactsService = moduleRef.get(ContactsService);
    sinistresService = moduleRef.get(SinistresService);
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
    it("réussit normalement sans aucun des 3 rattachements fourni, aucune vérification déclenchée", async () => {
      const sinistreCree = await contexteOrgA(() =>
        sinistresService.create(orgA.userId, { type: "degat_eaux", dateDeclaration: "2026-08-15" })
      );
      expect(sinistreCree.bienId).toBeNull();
      expect(sinistreCree.appartementId).toBeNull();
      expect(sinistreCree.contactAssureurId).toBeNull();
    });

    it("bienId : réussit avec un id propre à l'organisation", async () => {
      const sinistreCree = await contexteOrgA(() =>
        sinistresService.create(orgA.userId, { type: "degat_eaux", dateDeclaration: "2026-08-15", bienId: orgA.bienId })
      );
      expect(sinistreCree.bienId).toBe(orgA.bienId);
    });

    it("bienId : 404 cross-org, aucun sinistre créé", async () => {
      await expect(
        contexteOrgB(() =>
          sinistresService.create(orgB.userId, {
            type: "degat_eaux",
            dateDeclaration: "2026-08-15",
            bienId: orgA.bienId,
            description: "Bien étranger"
          })
        )
      ).rejects.toThrow(NotFoundException);
      const lignes = await db.select().from(sinistre).where(eq(sinistre.description, "Bien étranger"));
      expect(lignes).toHaveLength(0);
    });

    it("appartementId : réussit avec un id propre à l'organisation", async () => {
      const sinistreCree = await contexteOrgA(() =>
        sinistresService.create(orgA.userId, {
          type: "degat_eaux",
          dateDeclaration: "2026-08-15",
          appartementId: orgA.appartementId
        })
      );
      expect(sinistreCree.appartementId).toBe(orgA.appartementId);
    });

    it("appartementId : 404 cross-org, aucun sinistre créé", async () => {
      await expect(
        contexteOrgB(() =>
          sinistresService.create(orgB.userId, {
            type: "degat_eaux",
            dateDeclaration: "2026-08-15",
            appartementId: orgA.appartementId,
            description: "Appartement étranger"
          })
        )
      ).rejects.toThrow(NotFoundException);
      const lignes = await db.select().from(sinistre).where(eq(sinistre.description, "Appartement étranger"));
      expect(lignes).toHaveLength(0);
    });

    it("contactAssureurId : réussit avec un id propre à l'organisation", async () => {
      const sinistreCree = await contexteOrgA(() =>
        sinistresService.create(orgA.userId, {
          type: "degat_eaux",
          dateDeclaration: "2026-08-15",
          contactAssureurId: orgA.contactId
        })
      );
      expect(sinistreCree.contactAssureurId).toBe(orgA.contactId);
    });

    it("contactAssureurId : 404 cross-org, aucun sinistre créé", async () => {
      await expect(
        contexteOrgB(() =>
          sinistresService.create(orgB.userId, {
            type: "degat_eaux",
            dateDeclaration: "2026-08-15",
            contactAssureurId: orgA.contactId,
            description: "Contact étranger"
          })
        )
      ).rejects.toThrow(NotFoundException);
      const lignes = await db.select().from(sinistre).where(eq(sinistre.description, "Contact étranger"));
      expect(lignes).toHaveLength(0);
    });
  });

  describe("update", () => {
    it("bienId : réussit avec un id propre à l'organisation", async () => {
      const sinistreCree = await contexteOrgA(() =>
        sinistresService.create(orgA.userId, { type: "degat_eaux", dateDeclaration: "2026-08-15" })
      );
      const misAJour = await contexteOrgA(() => sinistresService.update(sinistreCree.id, { bienId: orgA.bienId }));
      expect(misAJour.bienId).toBe(orgA.bienId);
    });

    it("bienId : 404 cross-org, le sinistre original reste inchangé", async () => {
      const sinistreCree = await contexteOrgB(() =>
        sinistresService.create(orgB.userId, { type: "degat_eaux", dateDeclaration: "2026-08-15" })
      );
      await expect(
        contexteOrgB(() => sinistresService.update(sinistreCree.id, { bienId: orgA.bienId }))
      ).rejects.toThrow(NotFoundException);
      const [inchange] = await db.select().from(sinistre).where(eq(sinistre.id, sinistreCree.id));
      expect(inchange?.bienId).toBeNull();
    });

    it("appartementId : réussit avec un id propre à l'organisation", async () => {
      const sinistreCree = await contexteOrgA(() =>
        sinistresService.create(orgA.userId, { type: "degat_eaux", dateDeclaration: "2026-08-15" })
      );
      const misAJour = await contexteOrgA(() =>
        sinistresService.update(sinistreCree.id, { appartementId: orgA.appartementId })
      );
      expect(misAJour.appartementId).toBe(orgA.appartementId);
    });

    it("appartementId : 404 cross-org, le sinistre original reste inchangé", async () => {
      const sinistreCree = await contexteOrgB(() =>
        sinistresService.create(orgB.userId, { type: "degat_eaux", dateDeclaration: "2026-08-15" })
      );
      await expect(
        contexteOrgB(() => sinistresService.update(sinistreCree.id, { appartementId: orgA.appartementId }))
      ).rejects.toThrow(NotFoundException);
      const [inchange] = await db.select().from(sinistre).where(eq(sinistre.id, sinistreCree.id));
      expect(inchange?.appartementId).toBeNull();
    });

    it("contactAssureurId : réussit avec un id propre à l'organisation", async () => {
      const sinistreCree = await contexteOrgA(() =>
        sinistresService.create(orgA.userId, { type: "degat_eaux", dateDeclaration: "2026-08-15" })
      );
      const misAJour = await contexteOrgA(() =>
        sinistresService.update(sinistreCree.id, { contactAssureurId: orgA.contactId })
      );
      expect(misAJour.contactAssureurId).toBe(orgA.contactId);
    });

    it("contactAssureurId : 404 cross-org, le sinistre original reste inchangé", async () => {
      const sinistreCree = await contexteOrgB(() =>
        sinistresService.create(orgB.userId, { type: "degat_eaux", dateDeclaration: "2026-08-15" })
      );
      await expect(
        contexteOrgB(() => sinistresService.update(sinistreCree.id, { contactAssureurId: orgA.contactId }))
      ).rejects.toThrow(NotFoundException);
      const [inchange] = await db.select().from(sinistre).where(eq(sinistre.id, sinistreCree.id));
      expect(inchange?.contactAssureurId).toBeNull();
    });

    it("404 sur un sinistreId inexistant", async () => {
      await expect(
        contexteOrgA(() => sinistresService.update(randomUUID(), { bienId: orgA.bienId }))
      ).rejects.toThrow(NotFoundException);
    });
  });
});
