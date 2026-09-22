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
//
// archiver()/desarchiver() n'étaient pas protégées par ce sous-commit
// (Catégorie C, audit séparé) — corrigées en Priorité 3a (2026-09-19) via
// resoudreMessageAvecAppartenance(), le même helper privé que findById()
// ci-dessus.
describe("MessagesCommunicationService — contrôle d'appartenance à l'organisation (findById/archiver/desarchiver, intégration Postgres réelle)", () => {
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

  describe("findById", () => {
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

  describe("archiver / desarchiver", () => {
    it("archiver réussit normalement quand le message appartient à l'organisation appelante", async () => {
      const message = await contexteOrgA(() => messagesCommunicationService.archiver(orgA.messageId));
      expect(message.archivedAt).not.toBeNull();
    });

    it("archiver : 404 sur le messageId d'une autre organisation, sans jamais archiver la ligne étrangère", async () => {
      await expect(contexteOrgB(() => messagesCommunicationService.archiver(orgA.messageId))).rejects.toThrow(
        NotFoundException
      );
      const [inchange] = await db.select().from(messageCommunication).where(eq(messageCommunication.id, orgA.messageId));
      expect(inchange?.archivedAt).toBeNull();
    });

    it("archiver : 404 sur un messageId inexistant", async () => {
      await expect(contexteOrgA(() => messagesCommunicationService.archiver(randomUUID()))).rejects.toThrow(
        NotFoundException
      );
    });

    it("archiver : hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const message = await requestContextService.executerAvecContexte({ utilisateurId: null }, () =>
        messagesCommunicationService.archiver(orgA.messageId)
      );
      expect(message.archivedAt).not.toBeNull();
    });

    it("desarchiver réussit normalement quand le message appartient à l'organisation appelante", async () => {
      await contexteOrgA(() => messagesCommunicationService.archiver(orgA.messageId));
      const message = await contexteOrgA(() => messagesCommunicationService.desarchiver(orgA.messageId));
      expect(message.archivedAt).toBeNull();
    });

    it("desarchiver : 404 sur le messageId d'une autre organisation, sans jamais modifier la ligne étrangère", async () => {
      await contexteOrgA(() => messagesCommunicationService.archiver(orgA.messageId));
      await expect(contexteOrgB(() => messagesCommunicationService.desarchiver(orgA.messageId))).rejects.toThrow(
        NotFoundException
      );
      const [inchange] = await db.select().from(messageCommunication).where(eq(messageCommunication.id, orgA.messageId));
      expect(inchange?.archivedAt).not.toBeNull();
    });

    it("desarchiver : 404 sur un messageId inexistant", async () => {
      await expect(contexteOrgA(() => messagesCommunicationService.desarchiver(randomUUID()))).rejects.toThrow(
        NotFoundException
      );
    });

    it("desarchiver : hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      await contexteOrgA(() => messagesCommunicationService.archiver(orgA.messageId));
      const message = await requestContextService.executerAvecContexte({ utilisateurId: null }, () =>
        messagesCommunicationService.desarchiver(orgA.messageId)
      );
      expect(message.archivedAt).toBeNull();
    });
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
//
// obtenirContenuPieceJointe() avait la même lacune (aucun contrôle
// d'appartenance) — signalée sans être corrigée en Priorité 2, corrigée en
// Priorité 3a (2026-09-19) puisque le helper existait déjà et que la
// correction ne demandait qu'un remplacement d'une ligne.
describe("MessagesCommunicationService.classerDansDocuments / obtenirContenuPieceJointe — contrôle d'appartenance (intégration Postgres réelle)", () => {
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

  // Priorité E5 (chantier scoping multi-organisation, Catégorie E,
  // 2026-09-19) : ce cas précis (pieceJointeId propre à l'appelant, mais
  // entiteId d'une AUTRE organisation) n'était couvert par aucun test
  // existant — le seul cas cross-org testé jusqu'ici portait sur
  // pieceJointeId, jamais sur entiteId isolément. Corrigé par
  // DocumentsService.verifierEntiteExiste() (appelée par
  // creerDepuisBuffer(), en aval de classerDansDocuments()), sans aucun
  // changement dans ce fichier de service. Contrairement au cas
  // pieceJointeId cross-org ci-dessus, le déchiffrement de la pièce jointe
  // a bien lieu ici (documentStorageService.lire) puisque pieceJointeId
  // appartient légitimement à l'appelant — la preuve d'absence d'effet de
  // bord porte donc sur documentStorageService.enregistrer (jamais appelé)
  // et sur l'absence de toute ligne documents créée pour l'entiteId
  // étranger.
  it("404 sur l'entiteId d'une autre organisation (pièce jointe pourtant propre), sans jamais écrire de blob ni créer de document — ferme le volet signalé en Priorité 2", async () => {
    const enregistrerSpy = vi.spyOn(documentStorageService, "enregistrer");

    await expect(
      contexteOrgA(() =>
        messagesCommunicationService.classerDansDocuments(orgA.pieceJointeId, {
          entiteType: "locataire",
          entiteId: orgB.locataireId,
          categorie: "courrier"
        })
      )
    ).rejects.toThrow(NotFoundException);

    expect(enregistrerSpy).not.toHaveBeenCalled();

    const documentsCrees = await db.select().from(documents).where(eq(documents.entiteId, orgB.locataireId));
    expect(documentsCrees).toHaveLength(0);
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

  describe("obtenirContenuPieceJointe", () => {
    it("déchiffre normalement quand la pièce jointe appartient à l'organisation appelante", async () => {
      const resultat = await contexteOrgA(() => messagesCommunicationService.obtenirContenuPieceJointe(orgA.pieceJointeId));
      expect(resultat.contenu.toString("utf8")).toBe("contenu-A");
    });

    it("404 sur la pièceJointeId d'une autre organisation, sans jamais déchiffrer", async () => {
      const lireSpy = vi.spyOn(documentStorageService, "lire");

      await expect(
        contexteOrgB(() => messagesCommunicationService.obtenirContenuPieceJointe(orgA.pieceJointeId))
      ).rejects.toThrow(NotFoundException);

      expect(lireSpy).not.toHaveBeenCalled();
    });

    it("404 sur une pièceJointeId inexistante, sans jamais déchiffrer", async () => {
      const lireSpy = vi.spyOn(documentStorageService, "lire");

      await expect(
        contexteOrgA(() => messagesCommunicationService.obtenirContenuPieceJointe(randomUUID()))
      ).rejects.toThrow(NotFoundException);

      expect(lireSpy).not.toHaveBeenCalled();
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const resultat = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        messagesCommunicationService.obtenirContenuPieceJointe(orgA.pieceJointeId)
      );
      expect(resultat.contenu.toString("utf8")).toBe("contenu-A");
    });
  });
});
