import { randomUUID } from "crypto";
import path from "path";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, tache, utilisateurs, type Database } from "db";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { TachesModule } from "./taches.module";
import { TachesService } from "./taches.service";

// Fixture minimale committée réutilisée pour TachesModule (dépendance
// transitive de QuittanceDocumentDocxModule) — jamais utilisée ici
// puisque seul findById() est exercé, mais requise pour que le module se
// compile (même chemin que taches.integration.spec.ts).
process.env["QUITTANCE_DOCUMENT_DOCX_TEMPLATE_PATH"] = path.join(
  __dirname,
  "..",
  "quittance-document-docx",
  "__fixtures__",
  "modele-quittance-test.docx"
);

interface FixtureOrganisation {
  organisationId: string;
  tacheId: string;
}

// Sous-commit 5a (chantier scoping multi-organisation, 2026-09-18) :
// TachesService.findById() ne vérifiait jusqu'ici jamais l'appartenance à
// l'organisation. organisationId est une colonne directe : contrôle par
// simple comparaison. Aucun autre appelant interne (vérifié par grep —
// seul TachesController.findOne l'appelle). N'affecte PAS
// appliquerRevision()/envoyerNotification() : ces méthodes refont chacune
// leur propre requête brute sur `id`, sans jamais appeler this.findById()
// (Catégorie C, hors périmètre de ce sous-commit). Aucune méthode create()
// n'existe sur ce service (les tâches naissent de TachesJobService ou
// d'une génération liée aux alertes) — insertion directe en base pour la
// fixture, comme pour messages-communication-scoping.
describe("TachesService.findById — contrôle d'appartenance à l'organisation (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let tachesService: TachesService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Taches Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `taches-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `TachesScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }

    const [tacheRow] = await db
      .insert(tache)
      .values({ type: "autre", origine: "manuelle", organisationId: organisation.id })
      .returning();
    if (!tacheRow) {
      throw new Error("Échec de l'insertion de la tâche de test");
    }

    return { organisationId: organisation.id, tacheId: tacheRow.id };
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
        TachesModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    tachesService = moduleRef.get(TachesService);
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
    return requestContextService.executerAvecContexte({ utilisateurId: null, organisationId: orgA.organisationId }, fn);
  }
  function contexteOrgB<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte({ utilisateurId: null, organisationId: orgB.organisationId }, fn);
  }

  it("réussit normalement quand la tâche appartient à l'organisation appelante", async () => {
    const tacheDto = await contexteOrgA(() => tachesService.findById(orgA.tacheId));
    expect(tacheDto.id).toBe(orgA.tacheId);
  });

  it("404 sur le tacheId d'une autre organisation", async () => {
    await expect(contexteOrgB(() => tachesService.findById(orgA.tacheId))).rejects.toThrow(NotFoundException);
  });

  it("404 sur un tacheId inexistant", async () => {
    await expect(contexteOrgA(() => tachesService.findById(randomUUID()))).rejects.toThrow(NotFoundException);
  });

  it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
    const tacheDto = await requestContextService.executerAvecContexte({ utilisateurId: null }, () =>
      tachesService.findById(orgA.tacheId)
    );
    expect(tacheDto.id).toBe(orgA.tacheId);
  });
});
