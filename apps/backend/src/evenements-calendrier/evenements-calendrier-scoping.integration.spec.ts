import { randomUUID } from "crypto";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, evenementCalendrier, organisations, utilisateurs, type Database } from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuthModule } from "../auth/auth.module";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CandidatsModule } from "../candidats/candidats.module";
import { CandidatsService } from "../candidats/candidats.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { ContactsModule } from "../contacts/contacts.module";
import { ContactsService } from "../contacts/contacts.service";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { SinistresModule } from "../sinistres/sinistres.module";
import { SinistresService } from "../sinistres/sinistres.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { EvenementsCalendrierModule } from "./evenements-calendrier.module";
import { EvenementsCalendrierService } from "./evenements-calendrier.service";

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  evenementId: string;
}

// Sous-commit 5a (chantier scoping multi-organisation, 2026-09-18) :
// EvenementsCalendrierService.findById() ne vérifiait jusqu'ici jamais
// l'appartenance à l'organisation. organisationId est une colonne
// directe : contrôle par simple comparaison. Aucun autre appelant interne
// (vérifié par grep — seul EvenementsCalendrierController.findOne
// l'appelle ; findAllPourOrganisation(), utilisée par le flux ICS, est un
// chemin distinct qui n'appelle jamais findById()).
//
// update()/archive() n'étaient pas protégées par ce sous-commit (Catégorie
// C, audit séparé) — corrigées en Priorité 3a (2026-09-19) via
// resoudreEvenementAvecAppartenance(), le même helper privé que findById()
// (aucun appelant interne, seul EvenementsCalendrierController).
describe("EvenementsCalendrierService — contrôle d'appartenance à l'organisation (findById/update/archive, intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let evenementsCalendrierService: EvenementsCalendrierService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Evenements Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `evenements-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `EvenementsScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }

    const evenement = await evenementsCalendrierService.create(user.id, {
      type: "autre",
      titre: `Événement ${suffixe}`,
      dateDebut: "2026-08-15"
    });

    return { organisationId: organisation.id, userId: user.id, evenementId: evenement.id };
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
        EvenementsCalendrierModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    evenementsCalendrierService = moduleRef.get(EvenementsCalendrierService);
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
    it("réussit normalement quand l'événement appartient à l'organisation appelante", async () => {
      const evenementTrouve = await contexteOrgA(() => evenementsCalendrierService.findById(orgA.evenementId));
      expect(evenementTrouve.id).toBe(orgA.evenementId);
    });

    it("404 sur l'evenementId d'une autre organisation", async () => {
      await expect(contexteOrgB(() => evenementsCalendrierService.findById(orgA.evenementId))).rejects.toThrow(
        NotFoundException
      );
    });

    it("404 sur un evenementId inexistant", async () => {
      await expect(contexteOrgA(() => evenementsCalendrierService.findById(randomUUID()))).rejects.toThrow(
        NotFoundException
      );
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const evenementTrouve = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        evenementsCalendrierService.findById(orgA.evenementId)
      );
      expect(evenementTrouve.id).toBe(orgA.evenementId);
    });
  });

  describe("update", () => {
    it("réussit normalement quand l'événement appartient à l'organisation appelante", async () => {
      const misAJour = await contexteOrgA(() =>
        evenementsCalendrierService.update(orgA.evenementId, { titre: "Modifié" })
      );
      expect(misAJour.titre).toBe("Modifié");
    });

    it("404 sur l'evenementId d'une autre organisation, sans jamais modifier la ligne étrangère", async () => {
      await expect(
        contexteOrgB(() => evenementsCalendrierService.update(orgA.evenementId, { titre: "Modifié" }))
      ).rejects.toThrow(NotFoundException);
      const [inchange] = await db.select().from(evenementCalendrier).where(eq(evenementCalendrier.id, orgA.evenementId));
      expect(inchange?.titre).not.toBe("Modifié");
    });

    it("404 sur un evenementId inexistant", async () => {
      await expect(
        contexteOrgA(() => evenementsCalendrierService.update(randomUUID(), { titre: "Modifié" }))
      ).rejects.toThrow(NotFoundException);
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const misAJour = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        evenementsCalendrierService.update(orgA.evenementId, { titre: "Modifié" })
      );
      expect(misAJour.titre).toBe("Modifié");
    });
  });

  describe("archive", () => {
    it("réussit normalement quand l'événement appartient à l'organisation appelante", async () => {
      const archive = await contexteOrgA(() => evenementsCalendrierService.archive(orgA.evenementId));
      expect(archive.archivedAt).not.toBeNull();
    });

    it("404 sur l'evenementId d'une autre organisation, sans jamais archiver la ligne étrangère", async () => {
      await expect(contexteOrgB(() => evenementsCalendrierService.archive(orgA.evenementId))).rejects.toThrow(
        NotFoundException
      );
      const [inchange] = await db.select().from(evenementCalendrier).where(eq(evenementCalendrier.id, orgA.evenementId));
      expect(inchange?.archivedAt).toBeNull();
    });

    it("404 sur un evenementId inexistant", async () => {
      await expect(contexteOrgA(() => evenementsCalendrierService.archive(randomUUID()))).rejects.toThrow(
        NotFoundException
      );
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const archive = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        evenementsCalendrierService.archive(orgA.evenementId)
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
  candidatId: string;
  sinistreId: string;
}

// Priorité E6c (chantier scoping multi-organisation, Catégorie E,
// 2026-09-19) : bienId/appartementId/contactId/candidatId/sinistreId
// étaient écrits tels quels dans evenementCalendrier, sans jamais vérifier
// que l'entité rattachée appartient à l'organisation de l'appelant.
// evenementCalendrier.organisationId reste bien résolu depuis
// l'utilisateur (l'événement n'est jamais injecté chez un tiers), mais un
// id étranger sur l'un de ces champs dépasse le périmètre de l'app :
// CalendrierAbonnementService republie ces événements via un flux ICS
// public, accessible sans authentification à quiconque détient l'URL —
// donc une fuite ici expose potentiellement adresse/nom/rôle d'une
// personne ou d'un bien d'une autre organisation à un tiers non
// authentifié, pas seulement à un autre utilisateur de l'app. Corrigé via
// verifierAppartenancesEvenement() : bien/contact/candidat/sinistre ont
// tous une colonne organisationId directe (comparaison simple) ;
// appartements n'en a pas, jointure via bien requise (même limitation que
// CandidatsService.verifierAppartenanceAppartement, E6a). Aucun helper
// findById() des 5 services propriétaires réutilisable (privés, et
// EvenementsCalendrierModule ne dépend d'aucun des 5 modules) : reproduit
// directement, même pattern qu'E1-E6b. Le flux ICS lui-même (lecture
// seule, non authentifié par construction) reste hors périmètre de ce
// correctif — protégé indirectement du seul fait que les événements qu'il
// republie ne peuvent désormais plus contenir d'id étranger.
describe("EvenementsCalendrierService.create/update — contrôle d'appartenance sur bienId/appartementId/contactId/candidatId/sinistreId (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let contactsService: ContactsService;
  let candidatsService: CandidatsService;
  let sinistresService: SinistresService;
  let evenementsCalendrierService: EvenementsCalendrierService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisationRattachements;
  let orgB: FixtureOrganisationRattachements;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisationRattachements> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Evenements Rattachements ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `evenements-rattachements-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `EvenementsRattachements${suffixe}`,
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
      nom: `Contact ${suffixe}`,
      typeEntite: "personne_physique",
      role: "autre"
    });
    const candidat = await candidatsService.create(user.id, { nom: "Petit", prenom: `Julien${suffixe}` });
    const sinistre = await sinistresService.create(user.id, { type: "degat_eaux", dateDeclaration: "2026-08-01" });

    return {
      organisationId: organisation.id,
      userId: user.id,
      bienId: bien.id,
      appartementId: appartement.id,
      contactId: contact.id,
      candidatId: candidat.id,
      sinistreId: sinistre.id
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
        CandidatsModule,
        SinistresModule,
        EvenementsCalendrierModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    contactsService = moduleRef.get(ContactsService);
    candidatsService = moduleRef.get(CandidatsService);
    sinistresService = moduleRef.get(SinistresService);
    evenementsCalendrierService = moduleRef.get(EvenementsCalendrierService);
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
    it("réussit normalement sans aucun des 5 rattachements fourni, aucune vérification déclenchée", async () => {
      const evenement = await contexteOrgA(() =>
        evenementsCalendrierService.create(orgA.userId, { type: "autre", titre: "Sans rattachement", dateDebut: "2026-09-20T09:00:00.000Z" })
      );
      expect(evenement.bienId).toBeNull();
      expect(evenement.appartementId).toBeNull();
      expect(evenement.contactId).toBeNull();
      expect(evenement.candidatId).toBeNull();
      expect(evenement.sinistreId).toBeNull();
    });

    it("bienId : réussit avec un id propre à l'organisation", async () => {
      const evenement = await contexteOrgA(() =>
        evenementsCalendrierService.create(orgA.userId, {
          type: "autre",
          titre: "Bien propre",
          dateDebut: "2026-09-20T09:00:00.000Z",
          bienId: orgA.bienId
        })
      );
      expect(evenement.bienId).toBe(orgA.bienId);
    });

    it("bienId : 404 cross-org, aucun événement créé", async () => {
      await expect(
        contexteOrgB(() =>
          evenementsCalendrierService.create(orgB.userId, {
            type: "autre",
            titre: "Bien étranger",
            dateDebut: "2026-09-20T09:00:00.000Z",
            bienId: orgA.bienId
          })
        )
      ).rejects.toThrow(NotFoundException);
      const lignes = await db.select().from(evenementCalendrier).where(eq(evenementCalendrier.titre, "Bien étranger"));
      expect(lignes).toHaveLength(0);
    });

    it("appartementId : réussit avec un id propre à l'organisation", async () => {
      const evenement = await contexteOrgA(() =>
        evenementsCalendrierService.create(orgA.userId, {
          type: "etat_des_lieux",
          titre: "Appartement propre",
          dateDebut: "2026-09-20T09:00:00.000Z",
          appartementId: orgA.appartementId
        })
      );
      expect(evenement.appartementId).toBe(orgA.appartementId);
    });

    it("appartementId : 404 cross-org, aucun événement créé", async () => {
      await expect(
        contexteOrgB(() =>
          evenementsCalendrierService.create(orgB.userId, {
            type: "etat_des_lieux",
            titre: "Appartement étranger",
            dateDebut: "2026-09-20T09:00:00.000Z",
            appartementId: orgA.appartementId
          })
        )
      ).rejects.toThrow(NotFoundException);
      const lignes = await db.select().from(evenementCalendrier).where(eq(evenementCalendrier.titre, "Appartement étranger"));
      expect(lignes).toHaveLength(0);
    });

    it("contactId : réussit avec un id propre à l'organisation", async () => {
      const evenement = await contexteOrgA(() =>
        evenementsCalendrierService.create(orgA.userId, {
          type: "intervention_artisan",
          titre: "Contact propre",
          dateDebut: "2026-09-20T09:00:00.000Z",
          contactId: orgA.contactId
        })
      );
      expect(evenement.contactId).toBe(orgA.contactId);
    });

    it("contactId : 404 cross-org, aucun événement créé", async () => {
      await expect(
        contexteOrgB(() =>
          evenementsCalendrierService.create(orgB.userId, {
            type: "intervention_artisan",
            titre: "Contact étranger",
            dateDebut: "2026-09-20T09:00:00.000Z",
            contactId: orgA.contactId
          })
        )
      ).rejects.toThrow(NotFoundException);
      const lignes = await db.select().from(evenementCalendrier).where(eq(evenementCalendrier.titre, "Contact étranger"));
      expect(lignes).toHaveLength(0);
    });

    it("candidatId : réussit avec un id propre à l'organisation", async () => {
      const evenement = await contexteOrgA(() =>
        evenementsCalendrierService.create(orgA.userId, {
          type: "visite_candidat",
          titre: "Candidat propre",
          dateDebut: "2026-09-20T09:00:00.000Z",
          candidatId: orgA.candidatId
        })
      );
      expect(evenement.candidatId).toBe(orgA.candidatId);
    });

    it("candidatId : 404 cross-org, aucun événement créé", async () => {
      await expect(
        contexteOrgB(() =>
          evenementsCalendrierService.create(orgB.userId, {
            type: "visite_candidat",
            titre: "Candidat étranger",
            dateDebut: "2026-09-20T09:00:00.000Z",
            candidatId: orgA.candidatId
          })
        )
      ).rejects.toThrow(NotFoundException);
      const lignes = await db.select().from(evenementCalendrier).where(eq(evenementCalendrier.titre, "Candidat étranger"));
      expect(lignes).toHaveLength(0);
    });

    it("sinistreId : réussit avec un id propre à l'organisation", async () => {
      const evenement = await contexteOrgA(() =>
        evenementsCalendrierService.create(orgA.userId, {
          type: "expertise_sinistre",
          titre: "Sinistre propre",
          dateDebut: "2026-09-20T09:00:00.000Z",
          sinistreId: orgA.sinistreId
        })
      );
      expect(evenement.sinistreId).toBe(orgA.sinistreId);
    });

    it("sinistreId : 404 cross-org, aucun événement créé", async () => {
      await expect(
        contexteOrgB(() =>
          evenementsCalendrierService.create(orgB.userId, {
            type: "expertise_sinistre",
            titre: "Sinistre étranger",
            dateDebut: "2026-09-20T09:00:00.000Z",
            sinistreId: orgA.sinistreId
          })
        )
      ).rejects.toThrow(NotFoundException);
      const lignes = await db.select().from(evenementCalendrier).where(eq(evenementCalendrier.titre, "Sinistre étranger"));
      expect(lignes).toHaveLength(0);
    });
  });

  describe("update", () => {
    it("bienId : réussit avec un id propre à l'organisation", async () => {
      const evenement = await contexteOrgA(() =>
        evenementsCalendrierService.create(orgA.userId, { type: "autre", titre: "Base A", dateDebut: "2026-09-20T09:00:00.000Z" })
      );
      const misAJour = await contexteOrgA(() => evenementsCalendrierService.update(evenement.id, { bienId: orgA.bienId }));
      expect(misAJour.bienId).toBe(orgA.bienId);
    });

    it("bienId : 404 cross-org, l'événement original reste inchangé", async () => {
      const evenement = await contexteOrgB(() =>
        evenementsCalendrierService.create(orgB.userId, { type: "autre", titre: "Base B", dateDebut: "2026-09-20T09:00:00.000Z" })
      );
      await expect(
        contexteOrgB(() => evenementsCalendrierService.update(evenement.id, { bienId: orgA.bienId }))
      ).rejects.toThrow(NotFoundException);
      const [inchange] = await db.select().from(evenementCalendrier).where(eq(evenementCalendrier.id, evenement.id));
      expect(inchange?.bienId).toBeNull();
    });

    it("appartementId : réussit avec un id propre à l'organisation", async () => {
      const evenement = await contexteOrgA(() =>
        evenementsCalendrierService.create(orgA.userId, { type: "autre", titre: "Base A", dateDebut: "2026-09-20T09:00:00.000Z" })
      );
      const misAJour = await contexteOrgA(() =>
        evenementsCalendrierService.update(evenement.id, { appartementId: orgA.appartementId })
      );
      expect(misAJour.appartementId).toBe(orgA.appartementId);
    });

    it("appartementId : 404 cross-org, l'événement original reste inchangé", async () => {
      const evenement = await contexteOrgB(() =>
        evenementsCalendrierService.create(orgB.userId, { type: "autre", titre: "Base B", dateDebut: "2026-09-20T09:00:00.000Z" })
      );
      await expect(
        contexteOrgB(() => evenementsCalendrierService.update(evenement.id, { appartementId: orgA.appartementId }))
      ).rejects.toThrow(NotFoundException);
      const [inchange] = await db.select().from(evenementCalendrier).where(eq(evenementCalendrier.id, evenement.id));
      expect(inchange?.appartementId).toBeNull();
    });

    it("contactId : réussit avec un id propre à l'organisation", async () => {
      const evenement = await contexteOrgA(() =>
        evenementsCalendrierService.create(orgA.userId, { type: "autre", titre: "Base A", dateDebut: "2026-09-20T09:00:00.000Z" })
      );
      const misAJour = await contexteOrgA(() => evenementsCalendrierService.update(evenement.id, { contactId: orgA.contactId }));
      expect(misAJour.contactId).toBe(orgA.contactId);
    });

    it("contactId : 404 cross-org, l'événement original reste inchangé", async () => {
      const evenement = await contexteOrgB(() =>
        evenementsCalendrierService.create(orgB.userId, { type: "autre", titre: "Base B", dateDebut: "2026-09-20T09:00:00.000Z" })
      );
      await expect(
        contexteOrgB(() => evenementsCalendrierService.update(evenement.id, { contactId: orgA.contactId }))
      ).rejects.toThrow(NotFoundException);
      const [inchange] = await db.select().from(evenementCalendrier).where(eq(evenementCalendrier.id, evenement.id));
      expect(inchange?.contactId).toBeNull();
    });

    it("candidatId : réussit avec un id propre à l'organisation", async () => {
      const evenement = await contexteOrgA(() =>
        evenementsCalendrierService.create(orgA.userId, { type: "autre", titre: "Base A", dateDebut: "2026-09-20T09:00:00.000Z" })
      );
      const misAJour = await contexteOrgA(() => evenementsCalendrierService.update(evenement.id, { candidatId: orgA.candidatId }));
      expect(misAJour.candidatId).toBe(orgA.candidatId);
    });

    it("candidatId : 404 cross-org, l'événement original reste inchangé", async () => {
      const evenement = await contexteOrgB(() =>
        evenementsCalendrierService.create(orgB.userId, { type: "autre", titre: "Base B", dateDebut: "2026-09-20T09:00:00.000Z" })
      );
      await expect(
        contexteOrgB(() => evenementsCalendrierService.update(evenement.id, { candidatId: orgA.candidatId }))
      ).rejects.toThrow(NotFoundException);
      const [inchange] = await db.select().from(evenementCalendrier).where(eq(evenementCalendrier.id, evenement.id));
      expect(inchange?.candidatId).toBeNull();
    });

    it("sinistreId : réussit avec un id propre à l'organisation", async () => {
      const evenement = await contexteOrgA(() =>
        evenementsCalendrierService.create(orgA.userId, { type: "autre", titre: "Base A", dateDebut: "2026-09-20T09:00:00.000Z" })
      );
      const misAJour = await contexteOrgA(() => evenementsCalendrierService.update(evenement.id, { sinistreId: orgA.sinistreId }));
      expect(misAJour.sinistreId).toBe(orgA.sinistreId);
    });

    it("sinistreId : 404 cross-org, l'événement original reste inchangé", async () => {
      const evenement = await contexteOrgB(() =>
        evenementsCalendrierService.create(orgB.userId, { type: "autre", titre: "Base B", dateDebut: "2026-09-20T09:00:00.000Z" })
      );
      await expect(
        contexteOrgB(() => evenementsCalendrierService.update(evenement.id, { sinistreId: orgA.sinistreId }))
      ).rejects.toThrow(NotFoundException);
      const [inchange] = await db.select().from(evenementCalendrier).where(eq(evenementCalendrier.id, evenement.id));
      expect(inchange?.sinistreId).toBeNull();
    });

    it("404 sur un evenementId inexistant, la vérification de contexte se fait avant les rattachements", async () => {
      await expect(
        contexteOrgA(() => evenementsCalendrierService.update(randomUUID(), { bienId: orgA.bienId }))
      ).rejects.toThrow(NotFoundException);
    });
  });
});
