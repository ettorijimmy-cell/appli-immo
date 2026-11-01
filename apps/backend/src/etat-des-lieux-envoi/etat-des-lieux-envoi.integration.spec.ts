import { createHash, randomUUID } from "crypto";
import os from "os";
import path from "path";
import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
  PayloadTooLargeException
} from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  boiteMailDediee,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  etatDesLieuxEnvoi,
  messageCommunication,
  organisations,
  utilisateurs,
  type Database
} from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { BailLocatairesModule } from "../bail-locataires/bail-locataires.module";
import { BailLocatairesService } from "../bail-locataires/bail-locataires.service";
import { BauxModule } from "../baux/baux.module";
import { BauxService } from "../baux/baux.service";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { DocumentsModule } from "../documents/documents.module";
import { EtatDesLieuxDocumentDocxModule } from "../etat-des-lieux-document-docx/etat-des-lieux-document-docx.module";
import { EtatDesLieuxPdfModule } from "../etat-des-lieux-pdf/etat-des-lieux-pdf.module";
import { EtatDesLieuxPdfService } from "../etat-des-lieux-pdf/etat-des-lieux-pdf.service";
import { EtatsDesLieuxSignatureModule } from "../etats-des-lieux-signature/etats-des-lieux-signature.module";
import { EtatsDesLieuxSignatureService } from "../etats-des-lieux-signature/etats-des-lieux-signature.service";
import { EtatsDesLieuxModule } from "../etats-des-lieux/etats-des-lieux.module";
import { EtatsDesLieuxService } from "../etats-des-lieux/etats-des-lieux.service";
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
import { BoiteMailDedieeService } from "../messagerie/boite-mail-dediee.service";
import { SmtpEnvoiService } from "../messagerie/smtp-envoi.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { creerSimulateurGotenberg } from "../test-utils/gotenberg-simulateur";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { EtatDesLieuxEnvoiJobService } from "./etat-des-lieux-envoi-job.service";
import { EtatDesLieuxEnvoiModule } from "./etat-des-lieux-envoi.module";
import { DELAI_ABANDON_ENVOI_MS, EtatDesLieuxEnvoiService, TAILLE_MAX_PDF_ENVOI_OCTETS } from "./etat-des-lieux-envoi.service";

const sendMailMock = vi.hoisted(() => vi.fn());
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock })) }
}));

vi.setConfig({ testTimeout: 20000 });

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const EMAIL_JEAN = "jean.dupont@example.com";
const EMAIL_ALEX = "alex.martin@example.com";
const ADRESSE_DEPART = "1 rue du Départ, 69001 Lyon";

interface Fixture {
  organisationId: string;
  userId: string;
  etatDesLieuxId: string;
  bailId: string;
  jeanId: string;
  alexId: string;
}

describe("EtatDesLieuxEnvoiService (intégration Postgres réelle, SMTP et Gotenberg simulés)", () => {
  process.env["DOCUMENTS_STORAGE_DIR"] = path.join(os.tmpdir(), `appli-immo-test-envoi-edl-${randomUUID()}`);
  delete process.env["ETAT_DES_LIEUX_DOCUMENT_DOCX_TEMPLATE_PATH"];

  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);
  const GOTENBERG_URL_ORIGINAL = process.env["GOTENBERG_URL"];
  let simulateur: Awaited<ReturnType<typeof creerSimulateurGotenberg>>;

  let moduleRef: TestingModule;
  let db: Database;
  let service: EtatDesLieuxEnvoiService;
  let pdfService: EtatDesLieuxPdfService;
  let signatureService: EtatsDesLieuxSignatureService;
  let requestContext: RequestContextService;
  let bailLocatairesService: BailLocatairesService;
  let locatairesService: LocatairesService;
  let fixture: Fixture;

  function avecContexte<T>(f: Fixture, fn: () => Promise<T>): Promise<T> {
    return requestContext.executerAvecContexte({ utilisateurId: f.userId, organisationId: f.organisationId }, fn);
  }

  async function creerFixture(suffixe: string): Promise<Fixture> {
    const [organisation] = await db.insert(organisations).values({ type: "particulier", nom: `Org Envoi ${suffixe}` }).returning();
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation!.id,
        email: `envoi-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Envoi",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    const userId = user!.id;
    const sci = await moduleRef.get(ScisService).create(userId, {
      nom: `SCI Turgot ${suffixe}`,
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await moduleRef.get(BienService).create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: `Immeuble ${suffixe}`,
      adresse: "12 rue Turgot",
      codePostal: "75009",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartements = moduleRef.get(AppartementsService);
    const appartement = await appartements.create({
      bienId: bien.id,
      numero: suffixe,
      type: "T2",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    await appartements.update(appartement.id, { nombreChambres: 1, nombreSallesDeBain: 1, nombreWc: 1 });
    const jean = await locatairesService.create(userId, { nom: "Dupont", prenom: "Jean", email: EMAIL_JEAN });
    const alex = await locatairesService.create(userId, { nom: "Martin", prenom: "Alex", email: EMAIL_ALEX });
    const bail = await moduleRef.get(BauxService).create({
      appartementId: appartement.id,
      typeBail: "vide",
      dateDebut: "2026-08-01",
      loyerMensuel: "650.00",
      depotGarantie: "650.00",
      provisionsCharges: "30.00",
      jourEcheance: 5
    });
    await bailLocatairesService.create({ bailId: bail.id, locataireId: jean.id, role: "titulaire" });
    await bailLocatairesService.create({ bailId: bail.id, locataireId: alex.id, role: "colocataire" });
    const etat = await moduleRef.get(EtatsDesLieuxService).create({ bailId: bail.id });
    await moduleRef.get(BoiteMailDedieeService).configurer(userId, {
      email: `boite-${suffixe}@example.com`,
      motDePasseApp: "abcdefghijklmnop"
    });
    return {
      organisationId: organisation!.id,
      userId,
      etatDesLieuxId: etat.id,
      bailId: bail.id,
      jeanId: jean.id,
      alexId: alex.id
    };
  }

  function dtoSignature(f: Fixture, supplement: Record<string, unknown> = {}) {
    return {
      bailleur: { nomAffiche: "SCI Turgot", luEtApprouve: true, imagePng: PNG_1X1_BASE64 },
      locataires: [f.jeanId, f.alexId].map((locataireId) => ({ locataireId, luEtApprouve: true, imagePng: PNG_1X1_BASE64 })),
      ...supplement
    };
  }

  async function signerEntree(f: Fixture): Promise<void> {
    await avecContexte(f, () => signatureService.signerEntree(f.etatDesLieuxId, dtoSignature(f, { lieu: "Paris" })));
    await pdfService.attendreTachesEnCours();
  }

  async function signerSortie(f: Fixture): Promise<void> {
    await avecContexte(f, () =>
      signatureService.signerSortie(f.etatDesLieuxId, dtoSignature(f, { lieu: "Lyon", nouvelleAdresseLocataire: ADRESSE_DEPART }))
    );
    await pdfService.attendreTachesEnCours();
  }

  function dtoEnvoi(destinataires: { locataireId: string; email: string }[], demandeId: string = randomUUID()) {
    return { demandeId, destinataires };
  }

  function jean(f: Fixture = fixture) {
    return { locataireId: f.jeanId, email: EMAIL_JEAN };
  }

  function alex(f: Fixture = fixture) {
    return { locataireId: f.alexId, email: EMAIL_ALEX };
  }

  function envoyer(
    phase: "entree" | "sortie",
    dto: ReturnType<typeof dtoEnvoi>,
    f: Fixture = fixture
  ): ReturnType<EtatDesLieuxEnvoiService["envoyer"]> {
    return avecContexte(f, () => service.envoyer(f.etatDesLieuxId, phase, dto));
  }

  async function traces() {
    return db.select().from(etatDesLieuxEnvoi).where(eq(etatDesLieuxEnvoi.etatDesLieuxId, fixture.etatDesLieuxId));
  }

  beforeAll(async () => {
    simulateur = await creerSimulateurGotenberg();
    process.env["GOTENBERG_URL"] = simulateur.url;
  });

  beforeEach(async () => {
    simulateur.definirComportement({ type: "succes" });
    simulateur.reinitialiser();
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue({ messageId: "<remise@test>", response: "250 2.0.0 OK" });

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
        ScisModule,
        BienModule,
        AppartementsModule,
        LocatairesModule,
        BauxModule,
        BailLocatairesModule,
        DocumentsModule,
        EtatsDesLieuxModule,
        EtatsDesLieuxSignatureModule,
        EtatDesLieuxDocumentDocxModule,
        EtatDesLieuxPdfModule,
        EtatDesLieuxEnvoiModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    service = moduleRef.get(EtatDesLieuxEnvoiService);
    pdfService = moduleRef.get(EtatDesLieuxPdfService);
    signatureService = moduleRef.get(EtatsDesLieuxSignatureService);
    requestContext = moduleRef.get(RequestContextService);
    bailLocatairesService = moduleRef.get(BailLocatairesService);
    locatairesService = moduleRef.get(LocatairesService);
    fixture = await creerFixture("A");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await pdfService.attendreTachesEnCours();
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await simulateur.fermer();
    if (GOTENBERG_URL_ORIGINAL === undefined) {
      delete process.env["GOTENBERG_URL"];
    } else {
      process.env["GOTENBERG_URL"] = GOTENBERG_URL_ORIGINAL;
    }
    await rootDb.$client.end();
  });

  describe("contrôle d'organisation fail-closed", () => {
    it("sans contexte organisation, les trois routes refusent", async () => {
      await signerEntree(fixture);
      const id = fixture.etatDesLieuxId;

      await expect(service.listerHistorique(id)).rejects.toThrow(NotFoundException);
      await expect(service.listerDestinataires(id, "entree")).rejects.toThrow(NotFoundException);
      await expect(service.envoyer(id, "entree", dtoEnvoi([jean()]))).rejects.toThrow(NotFoundException);
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it("une autre organisation reçoit le même refus sur les trois routes, sans aucun mail", async () => {
      await signerEntree(fixture);
      const autre = await creerFixture("B");
      const id = fixture.etatDesLieuxId;

      await expect(avecContexte(autre, () => service.listerHistorique(id))).rejects.toThrow(NotFoundException);
      await expect(avecContexte(autre, () => service.listerDestinataires(id, "entree"))).rejects.toThrow(NotFoundException);
      await expect(avecContexte(autre, () => service.envoyer(id, "entree", dtoEnvoi([jean()])))).rejects.toThrow(
        NotFoundException
      );
      expect(sendMailMock).not.toHaveBeenCalled();
      expect(await traces()).toHaveLength(0);
    });
  });

  describe("refus avant tout mail", () => {
    it("phase non signée", async () => {
      await signerEntree(fixture);

      await expect(envoyer("sortie", dtoEnvoi([jean()]))).rejects.toThrow(ConflictException);
      expect(sendMailMock).not.toHaveBeenCalled();
      expect(await traces()).toHaveLength(0);
    });

    it("PDF figé absent", async () => {
      simulateur.definirComportement({ type: "erreur", statut: 500 });
      vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      await signerEntree(fixture);

      await expect(envoyer("entree", dtoEnvoi([jean()]))).rejects.toThrow("Le PDF n'est pas encore prêt.");
      expect(sendMailMock).not.toHaveBeenCalled();
      expect(await traces()).toHaveLength(0);
    });

    it("destinataire étranger à la phase", async () => {
      await signerEntree(fixture);
      const tiers = await locatairesService.create(fixture.userId, { nom: "Tiers", prenom: "Luc", email: "luc@example.com" });

      await expect(envoyer("entree", dtoEnvoi([{ locataireId: tiers.id, email: "luc@example.com" }]))).rejects.toThrow(
        "Ce destinataire n'a pas signé cette partie de l'état des lieux."
      );
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it("colocataire ajouté au bail après la signature : toujours refusé", async () => {
      await signerEntree(fixture);
      const nouveau = await locatairesService.create(fixture.userId, { nom: "Tard", prenom: "Eva", email: "eva@example.com" });
      await bailLocatairesService.create({ bailId: fixture.bailId, locataireId: nouveau.id, role: "colocataire" });

      await expect(envoyer("entree", dtoEnvoi([{ locataireId: nouveau.id, email: "eva@example.com" }]))).rejects.toThrow(
        BadRequestException
      );
    });

    it("un seul destinataire invalide bloque tout l'envoi", async () => {
      await signerEntree(fixture);
      const tiersId = randomUUID();

      await expect(envoyer("entree", dtoEnvoi([jean(), { locataireId: tiersId, email: "x@example.com" }]))).rejects.toThrow(
        BadRequestException
      );
      expect(sendMailMock).not.toHaveBeenCalled();
      expect(await traces()).toHaveLength(0);
    });

    it.each([
      ["deux adresses séparées par une virgule", `${EMAIL_JEAN},${EMAIL_ALEX}`],
      ["point-virgule", `${EMAIL_JEAN};${EMAIL_ALEX}`],
      ["format invalide", "jean.dupont"],
      ["vide", ""]
    ])("adresse refusée : %s", async (_cas, email) => {
      await signerEntree(fixture);

      await expect(envoyer("entree", dtoEnvoi([{ locataireId: fixture.jeanId, email }]))).rejects.toThrow(
        "L'adresse e-mail de Jean Dupont n'est pas valide."
      );
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it("adresse différente de la fiche", async () => {
      await signerEntree(fixture);

      await expect(envoyer("entree", dtoEnvoi([{ locataireId: fixture.jeanId, email: "autre@example.com" }]))).rejects.toThrow(
        "L'adresse de Jean Dupont a changé. Vérifiez-la avant d'envoyer."
      );
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it("PDF au-delà de 18 Mo refusé, pile à 18 Mo accepté", async () => {
      await signerEntree(fixture);
      const lire = vi.spyOn(pdfService, "lirePdfFige");
      const figé = { documentId: (await pdfService.lirePdfFige(fixture.etatDesLieuxId, "entree"))!.documentId, nomFichier: "x.pdf" };

      lire.mockResolvedValueOnce({ ...figé, contenu: Buffer.alloc(TAILLE_MAX_PDF_ENVOI_OCTETS + 1) });
      await expect(envoyer("entree", dtoEnvoi([jean()]))).rejects.toThrow(PayloadTooLargeException);
      expect(sendMailMock).not.toHaveBeenCalled();
      expect(await traces()).toHaveLength(0);

      lire.mockResolvedValueOnce({ ...figé, contenu: Buffer.alloc(TAILLE_MAX_PDF_ENVOI_OCTETS) });
      const { resultats } = await envoyer("entree", dtoEnvoi([jean()]));
      expect(resultats[0]?.statut).toBe("envoye");
    });
  });

  describe("envoi réussi", () => {
    it("deux destinataires : un mail chacun, texte et pièce jointe exacts", async () => {
      await signerEntree(fixture);

      const { resultats } = await envoyer("entree", dtoEnvoi([jean(), alex()]));

      expect(resultats.map((r) => [r.nomDestinataire, r.statut])).toEqual([
        ["Jean Dupont", "envoye"],
        ["Alex Martin", "envoye"]
      ]);
      expect(sendMailMock).toHaveBeenCalledTimes(2);
      expect(sendMailMock.mock.calls.map(([m]) => m.to)).toEqual([EMAIL_JEAN, EMAIL_ALEX]);
      const [premier] = sendMailMock.mock.calls[0] as [Record<string, unknown>];
      expect(premier["subject"]).toBe("État des lieux d'entrée — 12 rue Turgot, 75009 Paris");
      expect(premier["text"]).toContain("l'état des lieux d'entrée du logement situé 12 rue Turgot, 75009 Paris");
      expect(premier["text"]).toContain("à Paris.");
      expect(premier["text"]).toContain("Cordialement,\nSCI Turgot");
      expect(premier["attachments"]).toEqual([
        expect.objectContaining({ filename: "etat-des-lieux-entree.pdf", contentType: "application/pdf" })
      ]);
    });

    it("sortie : lieu et PDF de la phase de sortie, jamais ceux de l'entrée", async () => {
      await signerEntree(fixture);
      await signerSortie(fixture);

      await envoyer("sortie", dtoEnvoi([jean()]));

      const [mail] = sendMailMock.mock.calls[0] as [Record<string, unknown>];
      expect(mail["subject"]).toBe("État des lieux de sortie — 12 rue Turgot, 75009 Paris");
      expect(mail["text"]).toContain("à Lyon.");
      const trace = (await traces())[0];
      const sortie = await pdfService.lirePdfFige(fixture.etatDesLieuxId, "sortie");
      expect(trace?.documentId).toBe(sortie?.documentId);
    });

    it("pdf_sha256 correspond aux octets exacts de la pièce jointe", async () => {
      await signerEntree(fixture);

      await envoyer("entree", dtoEnvoi([jean()]));

      const [mail] = sendMailMock.mock.calls[0] as [{ attachments: { content: Buffer }[] }];
      const joint = mail.attachments[0]?.content;
      if (!joint) throw new Error("Pièce jointe absente");
      const trace = (await traces())[0];
      expect(trace?.pdfSha256).toBe(createHash("sha256").update(joint).digest("hex"));
      expect(trace?.pdfSha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it("la trace conserve l'accusé, l'adresse utilisée et l'auteur", async () => {
      await signerEntree(fixture);
      const dto = dtoEnvoi([jean()]);

      await envoyer("entree", dto);

      const trace = (await traces())[0];
      expect(trace).toMatchObject({
        statut: "envoye",
        demandeId: dto.demandeId,
        phase: "entree",
        nomDestinataire: "Jean Dupont",
        adresseUtilisee: EMAIL_JEAN,
        adresseExpediteur: "boite-A@example.com",
        objet: "État des lieux d'entrée — 12 rue Turgot, 75009 Paris",
        smtpMessageId: "<remise@test>",
        smtpReponse: "250 2.0.0 OK",
        codeErreur: null,
        updatedBy: fixture.userId,
        organisationId: fixture.organisationId
      });
      expect(trace?.envoyeLe).toBeInstanceOf(Date);
    });

    it("le message rejoint le fil du locataire dans la messagerie", async () => {
      await signerEntree(fixture);

      await envoyer("entree", dtoEnvoi([jean()]));

      const trace = (await traces())[0];
      const [message] = await db
        .select()
        .from(messageCommunication)
        .where(eq(messageCommunication.id, trace?.messageCommunicationId ?? ""));
      expect(message?.classificationType).toBe("locataire");
      expect(message?.classificationId).toBe(fixture.jeanId);
    });
  });

  describe("rejeu du demandeId", () => {
    it("rejouer renvoie les résultats existants, aucun nouveau mail", async () => {
      await signerEntree(fixture);
      const dto = dtoEnvoi([jean(), alex()]);

      const premier = await envoyer("entree", dto);
      const second = await envoyer("entree", dto);

      expect(sendMailMock).toHaveBeenCalledTimes(2);
      expect(await traces()).toHaveLength(2);
      expect(second.resultats.map((r) => r.statut).sort()).toEqual(premier.resultats.map((r) => r.statut).sort());
    });

    it("le rejeu d'un échec ne retente rien : seule une nouvelle demande le fait", async () => {
      await signerEntree(fixture);
      vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      sendMailMock.mockRejectedValueOnce(Object.assign(new Error("hors ligne"), { code: "ETIMEDOUT" }));
      const dto = dtoEnvoi([jean()]);

      await envoyer("entree", dto);
      const rejeu = await envoyer("entree", dto);
      expect(rejeu.resultats[0]?.statut).toBe("echec");
      expect(sendMailMock).toHaveBeenCalledTimes(1);

      const nouvelle = await envoyer("entree", dtoEnvoi([jean()]));
      expect(nouvelle.resultats[0]?.statut).toBe("envoye");
      expect(sendMailMock).toHaveBeenCalledTimes(2);
      expect(await traces()).toHaveLength(2);
    });

    it("le rejeu répond même si la fiche a changé entre-temps", async () => {
      await signerEntree(fixture);
      const dto = dtoEnvoi([jean()]);
      await envoyer("entree", dto);
      await avecContexte(fixture, () => locatairesService.update(fixture.jeanId, { email: "nouvelle@example.com" }));

      const rejeu = await envoyer("entree", dto);

      expect(rejeu.resultats[0]?.adresseUtilisee).toBe(EMAIL_JEAN);
      expect(sendMailMock).toHaveBeenCalledTimes(1);
    });

    it("deux appels simultanés de la même demande : un seul mail", async () => {
      await signerEntree(fixture);
      const dto = dtoEnvoi([jean()]);

      const [a, b] = await Promise.all([envoyer("entree", dto), envoyer("entree", dto)]);

      expect(sendMailMock).toHaveBeenCalledTimes(1);
      expect(await traces()).toHaveLength(1);
      expect(a.resultats).toHaveLength(1);
      expect(b.resultats).toHaveLength(1);
    });

    it("un envoi en cours bloque une autre demande pour ce destinataire, sans second mail", async () => {
      await signerEntree(fixture);
      const pdf = await pdfService.lirePdfFige(fixture.etatDesLieuxId, "entree");
      await db.insert(etatDesLieuxEnvoi).values({
        etatDesLieuxId: fixture.etatDesLieuxId,
        phase: "entree",
        locataireId: fixture.jeanId,
        documentId: pdf!.documentId,
        pdfSha256: "0".repeat(64),
        demandeId: randomUUID(),
        nomDestinataire: "Jean Dupont",
        adresseUtilisee: EMAIL_JEAN,
        objet: "Objet",
        tenteLe: new Date(),
        organisationId: fixture.organisationId
      });

      const { resultats } = await envoyer("entree", dtoEnvoi([jean()]));

      expect(resultats[0]?.statut).toBe("en_cours");
      expect(sendMailMock).not.toHaveBeenCalled();
    });
  });

  describe("échecs d'envoi", () => {
    it("échec SMTP tracé par destinataire, les autres sont tentés", async () => {
      await signerEntree(fixture);
      vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      sendMailMock.mockRejectedValueOnce(
        Object.assign(new Error("535 refus pour boite-A@example.com"), { code: "EAUTH", responseCode: 535 })
      );

      const { resultats } = await envoyer("entree", dtoEnvoi([jean(), alex()]));

      expect(resultats.map((r) => r.statut)).toEqual(["echec", "envoye"]);
      expect(resultats[0]).toMatchObject({
        codeErreur: "SMTP_AUTHENTIFICATION",
        messageErreur: "La boîte mail a refusé la connexion. Vérifiez son mot de passe d'application.",
        envoyeLe: null
      });
      expect(JSON.stringify(resultats)).not.toContain("boite-A@example.com");
    });

    it("boîte non configurée : échec tracé avec son message, aucun mail", async () => {
      await signerEntree(fixture);
      await db
        .update(boiteMailDediee)
        .set({ archivedAt: new Date() })
        .where(eq(boiteMailDediee.organisationId, fixture.organisationId));

      const { resultats } = await envoyer("entree", dtoEnvoi([jean()]));

      expect(resultats[0]).toMatchObject({ statut: "echec", codeErreur: "BOITE_MAIL_NON_CONFIGUREE" });
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it("mot de passe illisible : échec tracé avec son message, aucun mail", async () => {
      await signerEntree(fixture);
      vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      await db
        .update(boiteMailDediee)
        .set({ motDePasseAppChiffre: "ZmF1eA==:ZmF1eC10YWctZmF1eC10YQ==:ZmF1eA==" })
        .where(eq(boiteMailDediee.organisationId, fixture.organisationId));

      const { resultats } = await envoyer("entree", dtoEnvoi([jean()]));

      expect(resultats[0]).toMatchObject({ statut: "echec", codeErreur: "BOITE_MAIL_ILLISIBLE" });
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it("mail parti sans journalisation messagerie : reste envoye, lien vide", async () => {
      await signerEntree(fixture);
      vi.spyOn(moduleRef.get(SmtpEnvoiService), "envoyerAvecAccuse").mockResolvedValueOnce({
        expediteur: "boite-A@example.com",
        smtpMessageId: "<remise@test>",
        reponseServeur: "250 2.0.0 OK",
        messageCommunicationId: null
      });

      const { resultats } = await envoyer("entree", dtoEnvoi([jean()]));

      expect(resultats[0]?.statut).toBe("envoye");
      const trace = (await traces())[0];
      expect(trace).toMatchObject({ statut: "envoye", smtpMessageId: "<remise@test>", messageCommunicationId: null });
    });

    it("mail parti mais statut non enregistré : jamais présenté comme un échec, ligne laissée en_cours", async () => {
      await signerEntree(fixture);
      vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      vi.spyOn(db, "update").mockImplementationOnce(() => {
        throw new Error("Base indisponible");
      });

      const { resultats } = await envoyer("entree", dtoEnvoi([jean()]));

      expect(sendMailMock).toHaveBeenCalledTimes(1);
      expect(resultats[0]).toMatchObject({ statut: "envoye", codeErreur: null });
      expect((await traces())[0]?.statut).toBe("en_cours");
    });

    it("erreur inattendue : tracée en echec, avec un message générique", async () => {
      await signerEntree(fixture);
      vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      vi.spyOn(moduleRef.get(SmtpEnvoiService), "envoyerAvecAccuse").mockRejectedValueOnce(new Error("détail interne"));

      const { resultats } = await envoyer("entree", dtoEnvoi([jean()]));

      expect(resultats[0]).toMatchObject({
        statut: "echec",
        codeErreur: "ERREUR_INATTENDUE",
        messageErreur: "L'envoi a échoué. Réessayez dans quelques minutes."
      });
      expect(JSON.stringify(resultats)).not.toContain("détail interne");
    });
  });

  describe("envois abandonnés", () => {
    async function ligneEnCours(ageMs: number) {
      const pdf = await pdfService.lirePdfFige(fixture.etatDesLieuxId, "entree");
      const [ligne] = await db
        .insert(etatDesLieuxEnvoi)
        .values({
          etatDesLieuxId: fixture.etatDesLieuxId,
          phase: "entree",
          locataireId: fixture.jeanId,
          documentId: pdf!.documentId,
          pdfSha256: "0".repeat(64),
          demandeId: randomUUID(),
          nomDestinataire: "Jean Dupont",
          adresseUtilisee: EMAIL_JEAN,
          objet: "Objet",
          tenteLe: new Date(Date.now() - ageMs),
          organisationId: fixture.organisationId
        })
        .returning();
      return ligne!;
    }

    async function statutDe(id: string) {
      const [ligne] = await db.select().from(etatDesLieuxEnvoi).where(eq(etatDesLieuxEnvoi.id, id));
      return ligne?.statut;
    }

    it("au-delà de 10 minutes : indetermine dès la lecture de l'historique", async () => {
      await signerEntree(fixture);
      const ligne = await ligneEnCours(DELAI_ABANDON_ENVOI_MS + 1000);

      const historique = await avecContexte(fixture, () => service.listerHistorique(fixture.etatDesLieuxId));

      expect(historique[0]?.statut).toBe("indetermine");
      expect(await statutDe(ligne.id)).toBe("indetermine");
    });

    it("en deçà de 10 minutes : reste en_cours", async () => {
      await signerEntree(fixture);
      const ligne = await ligneEnCours(DELAI_ABANDON_ENVOI_MS - 60_000);

      await avecContexte(fixture, () => service.listerHistorique(fixture.etatDesLieuxId));

      expect(await statutDe(ligne.id)).toBe("en_cours");
    });

    it("le job clôture sans contexte HTTP, y compris sans aucune lecture", async () => {
      await signerEntree(fixture);
      vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      const ligne = await ligneEnCours(DELAI_ABANDON_ENVOI_MS + 1000);

      await moduleRef.get(EtatDesLieuxEnvoiJobService).classerEnvoisAbandonnes();

      expect(await statutDe(ligne.id)).toBe("indetermine");
    });

    it("une ligne abandonnée libère un nouvel envoi au même destinataire", async () => {
      await signerEntree(fixture);
      await ligneEnCours(DELAI_ABANDON_ENVOI_MS + 1000);

      const { resultats } = await envoyer("entree", dtoEnvoi([jean()]));

      expect(resultats[0]?.statut).toBe("envoye");
      expect(sendMailMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("lectures", () => {
    it("destinataires : signataires de la phase, e-mail, PDF, dernier envoi", async () => {
      await signerEntree(fixture);
      await avecContexte(fixture, () => locatairesService.update(fixture.alexId, { email: null }));
      await envoyer("entree", dtoEnvoi([jean()]));

      const resultat = await avecContexte(fixture, () => service.listerDestinataires(fixture.etatDesLieuxId, "entree"));

      expect(resultat.pdfDisponible).toBe(true);
      const parNom = new Map(resultat.destinataires.map((d) => [d.nomAffiche, d]));
      expect(parNom.get("Jean Dupont")).toMatchObject({ email: EMAIL_JEAN, dernierEnvoi: { statut: "envoye" } });
      expect(parNom.get("Alex Martin")).toMatchObject({ email: null, dernierEnvoi: null });
    });

    it("destinataires : refus si la phase n'est pas signée", async () => {
      await signerEntree(fixture);

      await expect(
        avecContexte(fixture, () => service.listerDestinataires(fixture.etatDesLieuxId, "sortie"))
      ).rejects.toThrow(ConflictException);
    });

    it("historique : du plus récent au plus ancien, toutes phases", async () => {
      await signerEntree(fixture);
      await signerSortie(fixture);
      await envoyer("entree", dtoEnvoi([jean()]));
      await new Promise((r) => setTimeout(r, 5));
      await envoyer("sortie", dtoEnvoi([jean()]));

      const historique = await avecContexte(fixture, () => service.listerHistorique(fixture.etatDesLieuxId));

      expect(historique.map((h) => h.phase)).toEqual(["sortie", "entree"]);
      expect(historique[0]).toMatchObject({ statut: "envoye", adresseExpediteur: "boite-A@example.com" });
    });
  });
});
