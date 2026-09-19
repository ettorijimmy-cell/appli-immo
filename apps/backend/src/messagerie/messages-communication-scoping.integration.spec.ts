import { randomUUID } from "crypto";
import { rm } from "fs/promises";
import os from "os";
import path from "path";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  documents,
  messageCommunication,
  organisations,
  pieceJointeMessage,
  utilisateurs,
  type Database
} from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { DocumentsModule } from "../documents/documents.module";
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
import { DocumentStorageService } from "../storage/document-storage.service";
import { StorageModule } from "../storage/storage.module";
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

interface FixtureOrganisationClasser {
  organisationId: string;
  userId: string;
  locataireId: string;
  pieceJointeId: string;
}

// Priorité 2 (chantier scoping multi-organisation, Catégorie C, 2026-09-19) :
// classerDansDocuments() déchiffrait le contenu d'une pièce jointe et créait
// un vrai document dans le système polymorphe sans jamais vérifier
// l'organisation appelante. Corrigé via resoudrePieceJointeAvecAppartenance()
// — organisationId est une colonne directe sur pieceJointeMessage
// (dénormalisée depuis le message parent à la création), contrôle par
// simple comparaison. documentStorageService.lire doit rester non appelé
// sur le chemin refusé (aucun déchiffrement), et aucun document ne doit être
// créé pour l'entité ciblée par l'appelant.
describe("MessagesCommunicationService.classerDansDocuments — contrôle d'appartenance (intégration Postgres réelle)", () => {
  const storageDirTest = path.join(os.tmpdir(), `appli-immo-test-messages-classer-scoping-${randomUUID()}`);
  process.env["DOCUMENTS_STORAGE_DIR"] = storageDirTest;

  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let locatairesService: LocatairesService;
  let messagesCommunicationService: MessagesCommunicationService;
  let documentStorageService: DocumentStorageService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisationClasser;
  let orgB: FixtureOrganisationClasser;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisationClasser> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Messages Classer Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `messages-classer-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `MessagesClasserScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }

    const locataire = await locatairesService.create(user.id, { nom: "Devos", prenom: `Ilan${suffixe}` });

    const [messageRow] = await db
      .insert(messageCommunication)
      .values({
        direction: "recu",
        emailExpediteur: `expediteur-${suffixe}@example.com`,
        emailDestinataire: `boite-${suffixe}@example.com`,
        dateMessage: new Date(),
        organisationId: organisation.id
      })
      .returning();
    if (!messageRow) {
      throw new Error("Échec de l'insertion du message de test");
    }

    const cheminStockage = `messages/test/${randomUUID()}.enc`;
    await documentStorageService.enregistrer(Buffer.from(`contenu-${suffixe}`, "utf8"), cheminStockage);
    const [pieceRow] = await db
      .insert(pieceJointeMessage)
      .values({
        messageId: messageRow.id,
        nomFichier: `piece-${suffixe}.pdf`,
        cheminStockage,
        typeMime: "application/pdf",
        organisationId: organisation.id
      })
      .returning();
    if (!pieceRow) {
      throw new Error("Échec de l'insertion de la pièce jointe de test");
    }

    return { organisationId: organisation.id, userId: user.id, locataireId: locataire.id, pieceJointeId: pieceRow.id };
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
        StorageModule,
        LocatairesModule,
        DocumentsModule,
        MessagerieModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    locatairesService = moduleRef.get(LocatairesService);
    messagesCommunicationService = moduleRef.get(MessagesCommunicationService);
    documentStorageService = moduleRef.get(DocumentStorageService);
    requestContextService = moduleRef.get(RequestContextService);

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

  function contexteOrgA<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte({ utilisateurId: orgA.userId, organisationId: orgA.organisationId }, fn);
  }
  function contexteOrgB<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte({ utilisateurId: orgB.userId, organisationId: orgB.organisationId }, fn);
  }

  it("classe normalement quand la pièce jointe appartient à l'organisation appelante", async () => {
    const document = await contexteOrgA(() =>
      messagesCommunicationService.classerDansDocuments(orgA.pieceJointeId, {
        entiteType: "locataire",
        entiteId: orgA.locataireId,
        categorie: "courrier"
      })
    );
    expect(document.nomFichier).toBe("piece-A.pdf");
  });

  it("404 sur la pièceJointeId d'une autre organisation, sans jamais déchiffrer ni créer de document", async () => {
    const lireSpy = vi.spyOn(documentStorageService, "lire");

    await expect(
      contexteOrgB(() =>
        messagesCommunicationService.classerDansDocuments(orgA.pieceJointeId, {
          entiteType: "locataire",
          entiteId: orgB.locataireId,
          categorie: "courrier"
        })
      )
    ).rejects.toThrow(NotFoundException);

    expect(lireSpy).not.toHaveBeenCalled();

    const documentsCrees = await db.select().from(documents).where(eq(documents.entiteId, orgB.locataireId));
    expect(documentsCrees).toHaveLength(0);
  });

  it("404 sur une pièceJointeId inexistante, sans jamais déchiffrer", async () => {
    const lireSpy = vi.spyOn(documentStorageService, "lire");

    await expect(
      contexteOrgA(() =>
        messagesCommunicationService.classerDansDocuments(randomUUID(), {
          entiteType: "locataire",
          entiteId: orgA.locataireId,
          categorie: "courrier"
        })
      )
    ).rejects.toThrow(NotFoundException);

    expect(lireSpy).not.toHaveBeenCalled();
  });

  it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
    const document = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
      messagesCommunicationService.classerDansDocuments(orgA.pieceJointeId, {
        entiteType: "locataire",
        entiteId: orgA.locataireId,
        categorie: "courrier"
      })
    );
    expect(document.nomFichier).toBe("piece-A.pdf");
  });
});
