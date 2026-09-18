import { randomUUID } from "crypto";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, utilisateurs, type Database } from "db";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthModule } from "../auth/auth.module";
import { CandidatsModule } from "../candidats/candidats.module";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { GarantsModule } from "../garants/garants.module";
import { LocatairesModule } from "../locataires/locataires.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { ContactsModule } from "./contacts.module";
import { ContactsService } from "./contacts.service";

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  contactId: string;
}

// Sous-commit 5a (chantier scoping multi-organisation, 2026-09-18) :
// ContactsService.findById() ne vérifiait jusqu'ici jamais l'appartenance
// à l'organisation. organisationId est une colonne directe : contrôle par
// simple comparaison. Aucun autre appelant interne (vérifié par grep —
// seul ContactsController.findOne l'appelle ; findAllUnifie() n'appelle
// jamais findById(), seulement findAll()).
describe("ContactsService.findById — contrôle d'appartenance à l'organisation (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let contactsService: ContactsService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Contacts Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `contacts-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `ContactsScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }

    const contact = await contactsService.create(user.id, {
      nom: `Artisan ${suffixe}`,
      typeEntite: "personne_physique",
      role: "artisan"
    });

    return { organisationId: organisation.id, userId: user.id, contactId: contact.id };
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
        GarantsModule,
        CandidatsModule,
        ContactsModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    contactsService = moduleRef.get(ContactsService);
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

  it("réussit normalement quand le contact appartient à l'organisation appelante", async () => {
    const contact = await contexteOrgA(() => contactsService.findById(orgA.contactId));
    expect(contact.id).toBe(orgA.contactId);
  });

  it("404 sur le contactId d'une autre organisation", async () => {
    await expect(contexteOrgB(() => contactsService.findById(orgA.contactId))).rejects.toThrow(NotFoundException);
  });

  it("404 sur un contactId inexistant", async () => {
    await expect(contexteOrgA(() => contactsService.findById(randomUUID()))).rejects.toThrow(NotFoundException);
  });

  it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
    const contact = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
      contactsService.findById(orgA.contactId)
    );
    expect(contact.id).toBe(orgA.contactId);
  });
});
