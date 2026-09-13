import { randomUUID } from "crypto";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, utilisateurs, type Database } from "db";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { CandidatsModule } from "../candidats/candidats.module";
import { CandidatsService } from "../candidats/candidats.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { EvenementsCalendrierModule } from "./evenements-calendrier.module";
import { EvenementsCalendrierService } from "./evenements-calendrier.service";

// Module Calendrier d'interventions (2026-09-15) : événements planifiés
// (intervention artisan, visite candidat, état des lieux, autre), tous les
// rattachements (bien/appartement/contact/candidat) sont indépendamment
// optionnels. Chaque test tourne dans sa propre transaction annulée dans
// afterEach (test-utils/transactional-test.ts).
describe("EvenementsCalendrierService (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let evenementsService: EvenementsCalendrierService;
  let candidatsService: CandidatsService;
  let requestContextService: RequestContextService;
  let db: Database;
  let userId: string;
  let organisationId: string;

  beforeEach(async () => {
    db = await begin();

    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), CommonModule, DatabaseModule, UsersModule, CandidatsModule, EvenementsCalendrierModule]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    evenementsService = moduleRef.get(EvenementsCalendrierService);
    candidatsService = moduleRef.get(CandidatsService);
    requestContextService = moduleRef.get(RequestContextService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Calendrier Intégration" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    organisationId = organisation.id;

    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `calendrier-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Calendrier",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    userId = user.id;
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  it("crée un événement sans aucun rattachement (bien/appartement/contact/candidat tous optionnels)", async () => {
    const evenement = await evenementsService.create(userId, {
      type: "autre",
      titre: "Rappel divers",
      dateDebut: "2026-09-20T14:00:00.000Z"
    });

    expect(evenement.titre).toBe("Rappel divers");
    expect(evenement.bienId).toBeNull();
    expect(evenement.candidatId).toBeNull();
  });

  it("crée un événement visite_candidat rattaché à un candidat", async () => {
    const candidat = await candidatsService.create(userId, { nom: "Visiteur", prenom: "Test" });
    const evenement = await evenementsService.create(userId, {
      type: "visite_candidat",
      titre: "Visite appartement 3B",
      dateDebut: "2026-09-22T10:00:00.000Z",
      dateFin: "2026-09-22T10:30:00.000Z",
      candidatId: candidat.id
    });

    expect(evenement.type).toBe("visite_candidat");
    expect(evenement.candidatId).toBe(candidat.id);
    expect(evenement.dateFin).not.toBeNull();
  });

  it("filtre par type", async () => {
    await evenementsService.create(userId, { type: "intervention_artisan", titre: "Plombier", dateDebut: "2026-09-20T09:00:00.000Z" });
    await evenementsService.create(userId, { type: "autre", titre: "Autre chose", dateDebut: "2026-09-21T09:00:00.000Z" });

    const resultat = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      evenementsService.findAll({ type: "intervention_artisan" })
    );
    expect(resultat).toHaveLength(1);
    expect(resultat[0]?.titre).toBe("Plombier");
  });

  it("filtre par période (dateDebut incluse dans l'intervalle)", async () => {
    await evenementsService.create(userId, { type: "autre", titre: "Dans la période", dateDebut: "2026-09-15T09:00:00.000Z" });
    await evenementsService.create(userId, { type: "autre", titre: "Hors période", dateDebut: "2026-10-15T09:00:00.000Z" });

    const resultat = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      evenementsService.findAll({ periodeDebut: "2026-09-01T00:00:00.000Z", periodeFin: "2026-09-30T23:59:59.000Z" })
    );
    expect(resultat.map((e) => e.titre)).toEqual(["Dans la période"]);
  });

  it("met à jour un événement (titre, dates)", async () => {
    const evenement = await evenementsService.create(userId, {
      type: "autre",
      titre: "Titre initial",
      dateDebut: "2026-09-20T09:00:00.000Z"
    });
    const misAJour = await evenementsService.update(evenement.id, { titre: "Titre corrigé" });
    expect(misAJour.titre).toBe("Titre corrigé");
  });

  it("archive un événement sans le supprimer physiquement", async () => {
    const evenement = await evenementsService.create(userId, {
      type: "autre",
      titre: "À archiver",
      dateDebut: "2026-09-20T09:00:00.000Z"
    });
    const archive = await evenementsService.archive(evenement.id);
    expect(archive.archivedAt).not.toBeNull();
  });

  it("findAll scope par organisation", async () => {
    const [autreOrganisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Autre Organisation Calendrier" })
      .returning();
    if (!autreOrganisation) {
      throw new Error("Échec de l'insertion de l'autre organisation de test");
    }
    const [autreUser] = await db
      .insert(utilisateurs)
      .values({
        organisationId: autreOrganisation.id,
        email: `autre-org-calendrier-${randomUUID()}@example.com`,
        nom: "Autre",
        prenom: "OrgCalendrier",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!autreUser) {
      throw new Error("Échec de l'insertion de l'autre utilisateur de test");
    }

    const evenementOrgA = await evenementsService.create(userId, {
      type: "autre",
      titre: "Org A",
      dateDebut: "2026-09-20T09:00:00.000Z"
    });
    const evenementOrgB = await evenementsService.create(autreUser.id, {
      type: "autre",
      titre: "Org B",
      dateDebut: "2026-09-20T09:00:00.000Z"
    });

    const listeOrgA = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      evenementsService.findAll({})
    );
    expect(listeOrgA.map((e) => e.id)).toContain(evenementOrgA.id);
    expect(listeOrgA.map((e) => e.id)).not.toContain(evenementOrgB.id);
  });

  it("findAllPourOrganisation exclut les événements archivés (utilisé par le flux ICS)", async () => {
    const evenementActif = await evenementsService.create(userId, {
      type: "autre",
      titre: "Actif",
      dateDebut: "2026-09-20T09:00:00.000Z"
    });
    const evenementArchive = await evenementsService.create(userId, {
      type: "autre",
      titre: "Archivé",
      dateDebut: "2026-09-20T09:00:00.000Z"
    });
    await evenementsService.archive(evenementArchive.id);

    const resultat = await evenementsService.findAllPourOrganisation(organisationId);
    expect(resultat.map((e) => e.id)).toContain(evenementActif.id);
    expect(resultat.map((e) => e.id)).not.toContain(evenementArchive.id);
  });
});
