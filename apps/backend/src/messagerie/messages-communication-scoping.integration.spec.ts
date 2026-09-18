import { randomUUID } from "crypto";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, messageCommunication, organisations, utilisateurs, type Database } from "db";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { MessagerieModule } from "./messagerie.module";
import { MessagesCommunicationService } from "./messages-communication.service";

interface FixtureOrganisation {
  organisationId: string;
  messageId: string;
}

// Sous-commit 5a (chantier scoping multi-organisation, 2026-09-18) :
// MessagesCommunicationService.findById() ne vérifiait jusqu'ici jamais
// l'appartenance à l'organisation. organisationId est une colonne
// directe : contrôle par simple comparaison. Un seul appelant interne
// (this.findById(messageId) dans composer(), voir le commentaire sur
// findById() lui-même) — sans impact, le message vient d'être créé dans
// l'organisation de l'appelant. Aucune méthode create() directe (les
// messages naissent de SmtpEnvoiService/ImapSyncJobService) — insertion
// directe en base pour la fixture, comme pour taches-scoping.
describe("MessagesCommunicationService.findById — contrôle d'appartenance à l'organisation (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let messagesCommunicationService: MessagesCommunicationService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Messages Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `messages-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `MessagesScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }

    const [messageRow] = await db
      .insert(messageCommunication)
      .values({
        direction: "envoye",
        emailExpediteur: `boite-${suffixe}@example.com`,
        emailDestinataire: `destinataire-${suffixe}@example.com`,
        dateMessage: new Date(),
        organisationId: organisation.id
      })
      .returning();
    if (!messageRow) {
      throw new Error("Échec de l'insertion du message de test");
    }

    return { organisationId: organisation.id, messageId: messageRow.id };
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
        MessagerieModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    messagesCommunicationService = moduleRef.get(MessagesCommunicationService);
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

  it("réussit normalement quand le message appartient à l'organisation appelante", async () => {
    const message = await contexteOrgA(() => messagesCommunicationService.findById(orgA.messageId));
    expect(message?.id).toBe(orgA.messageId);
  });

  it("404 sur le messageId d'une autre organisation", async () => {
    await expect(contexteOrgB(() => messagesCommunicationService.findById(orgA.messageId))).rejects.toThrow(
      NotFoundException
    );
  });

  it("404 sur un messageId inexistant", async () => {
    await expect(contexteOrgA(() => messagesCommunicationService.findById(randomUUID()))).rejects.toThrow(
      NotFoundException
    );
  });

  it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
    const message = await requestContextService.executerAvecContexte({ utilisateurId: null }, () =>
      messagesCommunicationService.findById(orgA.messageId)
    );
    expect(message?.id).toBe(orgA.messageId);
  });
});
