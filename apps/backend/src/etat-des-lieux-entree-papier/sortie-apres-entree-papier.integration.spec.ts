import { createHash, randomUUID } from "crypto";
import os from "os";
import path from "path";
import { ConflictException, PayloadTooLargeException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  documents,
  etatDesLieuxEntreePapier,
  etatDesLieuxEnvoi,
  organisations,
  pieceJointeMessage,
  utilisateurs,
  type Database
} from "db";
import { and, eq } from "drizzle-orm";
import PizZip from "pizzip";
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
import { DocumentsService } from "../documents/documents.service";
import { EtatDesLieuxDocumentDocxModule } from "../etat-des-lieux-document-docx/etat-des-lieux-document-docx.module";
import { EtatDesLieuxEnvoiModule } from "../etat-des-lieux-envoi/etat-des-lieux-envoi.module";
import {
  EtatDesLieuxEnvoiService,
  NOM_FICHIER_SCAN_ENTREE_PAPIER,
  TAILLE_MAX_PDF_ENVOI_OCTETS
} from "../etat-des-lieux-envoi/etat-des-lieux-envoi.service";
import { EtatDesLieuxPdfModule } from "../etat-des-lieux-pdf/etat-des-lieux-pdf.module";
import { EtatDesLieuxPdfService, MESSAGE_ENTREE_PAPIER_SANS_DOCUMENT } from "../etat-des-lieux-pdf/etat-des-lieux-pdf.service";
import { EtatsDesLieuxSignatureModule } from "../etats-des-lieux-signature/etats-des-lieux-signature.module";
import { EtatsDesLieuxSignatureService } from "../etats-des-lieux-signature/etats-des-lieux-signature.service";
import { EtatsDesLieuxModule } from "../etats-des-lieux/etats-des-lieux.module";
import { EtatsDesLieuxService } from "../etats-des-lieux/etats-des-lieux.service";
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
import { BoiteMailDedieeService } from "../messagerie/boite-mail-dediee.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { creerSimulateurGotenberg } from "../test-utils/gotenberg-simulateur";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { EtatDesLieuxEntreePapierModule } from "./etat-des-lieux-entree-papier.module";
import { EtatDesLieuxEntreePapierService } from "./etat-des-lieux-entree-papier.service";

const sendMailMock = vi.hoisted(() => vi.fn());
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock })) }
}));

vi.setConfig({ testTimeout: 20000 });

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const EMAIL_JEAN = "jean.dupont@example.com";
const ADRESSE_DEPART = "1 rue du Départ, 69001 Lyon";
const SCAN = Buffer.from("%PDF-1.4\n% scan de l'entree papier\n%%EOF\n");
const MENTION =
  "État des lieux d'entrée établi et signé sur papier le 01/08/2026 à Paris par SCI Turgot, Jean Dupont et Alex Martin. Original conservé par le bailleur.";

function texteDuDocx(buffer: Buffer): string {
  return new PizZip(buffer)
    .file("word/document.xml")!
    .asText()
    .replace(/<[^>]+>/g, "")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&");
}

// Commit 5 du chantier entrée papier (2026-11-06) : document de sortie avec
// la mention papier, PDF et relance qui ignorent l'entrée papier, envoi de la
// sortie avec le scan d'entrée joint, envoi d'entrée refusé. SMTP et
// Gotenberg simulés, comme etat-des-lieux-envoi.integration.spec.ts.
describe("Sortie après une entrée papier (intégration Postgres réelle, SMTP et Gotenberg simulés)", () => {
  process.env["DOCUMENTS_STORAGE_DIR"] = path.join(os.tmpdir(), `appli-immo-test-sortie-papier-${randomUUID()}`);
  delete process.env["ETAT_DES_LIEUX_DOCUMENT_DOCX_TEMPLATE_PATH"];

  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);
  const GOTENBERG_URL_ORIGINAL = process.env["GOTENBERG_URL"];
  let simulateur: Awaited<ReturnType<typeof creerSimulateurGotenberg>>;

  let moduleRef: TestingModule;
  let db: Database;
  let envoiService: EtatDesLieuxEnvoiService;
  let pdfService: EtatDesLieuxPdfService;
  let signatureService: EtatsDesLieuxSignatureService;
  let entreePapierService: EtatDesLieuxEntreePapierService;
  let documentsService: DocumentsService;
  let requestContext: RequestContextService;
  let contexte: { utilisateurId: string; organisationId: string };
  let dossier: { etatDesLieuxId: string; jeanId: string; alexId: string };

  function avecContexte<T>(fn: () => Promise<T>): Promise<T> {
    return requestContext.executerAvecContexte(contexte, fn);
  }

  async function creerDossier() {
    const [organisation] = await db.insert(organisations).values({ type: "particulier", nom: "Org Papier" }).returning();
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation!.id,
        email: `sortie-papier-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Papier",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    contexte = { utilisateurId: user!.id, organisationId: organisation!.id };
    const userId = user!.id;
    const sci = await moduleRef.get(ScisService).create(userId, {
      nom: "SCI Turgot",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await moduleRef.get(BienService).create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Papier",
      adresse: "12 rue Turgot",
      codePostal: "75009",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartements = moduleRef.get(AppartementsService);
    const appartement = await appartements.create({
      bienId: bien.id,
      numero: "1",
      type: "T2",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    await appartements.update(appartement.id, { nombreChambres: 1, nombreSallesDeBain: 1, nombreWc: 1 });
    const locataires = moduleRef.get(LocatairesService);
    const jean = await locataires.create(userId, { nom: "Dupont", prenom: "Jean", email: EMAIL_JEAN });
    const alex = await locataires.create(userId, { nom: "Martin", prenom: "Alex", email: "alex.martin@example.com" });
    const bail = await moduleRef.get(BauxService).create({
      appartementId: appartement.id,
      typeBail: "vide",
      dateDebut: "2026-08-01",
      loyerMensuel: "650.00",
      depotGarantie: "650.00",
      provisionsCharges: "30.00",
      jourEcheance: 5
    });
    const bailLocataires = moduleRef.get(BailLocatairesService);
    await bailLocataires.create({ bailId: bail.id, locataireId: jean.id, role: "titulaire" });
    await bailLocataires.create({ bailId: bail.id, locataireId: alex.id, role: "colocataire" });
    const etat = await avecContexte(() => moduleRef.get(EtatsDesLieuxService).create({ bailId: bail.id }));
    await moduleRef.get(BoiteMailDedieeService).configurer(userId, {
      email: "boite-papier@example.com",
      motDePasseApp: "abcdefghijklmnop"
    });
    return { etatDesLieuxId: etat.id, jeanId: jean.id, alexId: alex.id };
  }

  function dtoSignature(supplement: Record<string, unknown> = {}) {
    return {
      bailleur: { nomAffiche: "SCI Turgot", luEtApprouve: true, imagePng: PNG_1X1_BASE64 },
      locataires: [dossier.jeanId, dossier.alexId].map((locataireId) => ({
        locataireId,
        luEtApprouve: true,
        imagePng: PNG_1X1_BASE64
      })),
      ...supplement
    };
  }

  async function declarerEntreePapier() {
    await avecContexte(() =>
      entreePapierService.declarer(
        dossier.etatDesLieuxId,
        {
          dateSignature: "2026-08-01",
          lieu: "Paris",
          bailleurNom: "SCI Turgot",
          locataireIds: [dossier.jeanId, dossier.alexId]
        },
        { nomFichier: "scan-du-papier.pdf", contenu: SCAN }
      )
    );
  }

  async function signerSortie() {
    await avecContexte(() =>
      signatureService.signerSortie(
        dossier.etatDesLieuxId,
        dtoSignature({ lieu: "Lyon", nouvelleAdresseLocataire: ADRESSE_DEPART })
      )
    );
    await pdfService.attendreTachesEnCours();
  }

  async function docxFige(phase: "entree" | "sortie"): Promise<Buffer | null> {
    const [ligne] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.entiteId, dossier.etatDesLieuxId),
          eq(documents.categorie, "etat_des_lieux_docx"),
          eq(documents.etatDesLieuxPhase, phase)
        )
      );
    if (!ligne) {
      return null;
    }
    return (await avecContexte(() => documentsService.telecharger(ligne.id))).contenu;
  }

  function envoyer(phase: "entree" | "sortie") {
    return avecContexte(() =>
      envoiService.envoyer(dossier.etatDesLieuxId, phase, {
        demandeId: randomUUID(),
        destinataires: [{ locataireId: dossier.jeanId, email: EMAIL_JEAN }]
      })
    );
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
        EtatDesLieuxEntreePapierModule,
        EtatDesLieuxDocumentDocxModule,
        EtatDesLieuxPdfModule,
        EtatDesLieuxEnvoiModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    envoiService = moduleRef.get(EtatDesLieuxEnvoiService);
    pdfService = moduleRef.get(EtatDesLieuxPdfService);
    signatureService = moduleRef.get(EtatsDesLieuxSignatureService);
    entreePapierService = moduleRef.get(EtatDesLieuxEntreePapierService);
    documentsService = moduleRef.get(DocumentsService);
    requestContext = moduleRef.get(RequestContextService);
    dossier = await creerDossier();
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

  describe("document et PDF figés", () => {
    it("après la signature de sortie : .docx et PDF de sortie figés, mention papier imprimée, aucun document d'entrée", async () => {
      await declarerEntreePapier();
      await signerSortie();

      const docs = await avecContexte(() => pdfService.listerDocumentsFiges(dossier.etatDesLieuxId));
      expect(docs.find((d) => d.phase === "sortie")).toMatchObject({ docx: expect.anything(), pdf: expect.anything() });
      expect(docs.find((d) => d.phase === "entree")).toMatchObject({ docx: null, pdf: null });
      await pdfService.attendreTachesEnCours();
      expect(await docxFige("entree")).toBeNull();

      const texte = texteDuDocx((await docxFige("sortie"))!);
      expect(texte).toContain(MENTION);
      // Partie entrée du bloc des signatures : la mention courte remplace
      // « Le … à … », plus aucun pointillé de date ni de lieu ; aucune
      // signature numérique d'entrée.
      expect(texte).toContain("Signé sur papier le 01/08/2026 — original conservé par le bailleur");
      expect(texte).not.toContain("…..…..…..…..…...…..…..…..…");
      expect(texte.split("Lu et approuvé — SCI Turgot")).toHaveLength(2);
    });

    it("la relance planifiée ignore l'entrée papier", async () => {
      await declarerEntreePapier();
      await signerSortie();
      const incomplets = await pdfService.trouverPhasesSigneesIncompletes();
      expect(incomplets.filter((i) => i.etatDesLieuxId === dossier.etatDesLieuxId)).toEqual([]);
    });

    it("« Produire le PDF » d'entrée : refus explicite, rien n'est produit", async () => {
      await declarerEntreePapier();
      await expect(
        avecContexte(() => pdfService.produireManuellement(dossier.etatDesLieuxId, "entree"))
      ).rejects.toThrow(MESSAGE_ENTREE_PAPIER_SANS_DOCUMENT);
      expect(simulateur.nombreAppels()).toBe(0);
      expect(await docxFige("entree")).toBeNull();
    });

    it("non-régression : sortie entièrement numérique, aucune mention papier", async () => {
      await avecContexte(() => signatureService.signerEntree(dossier.etatDesLieuxId, dtoSignature({ lieu: "Paris" })));
      await signerSortie();
      const texte = texteDuDocx((await docxFige("sortie"))!);
      expect(texte).not.toContain("établi et signé sur papier");
      expect(texte).not.toContain("Signé sur papier");
      // Date et lieu d'entrée toujours imprimés dans le bloc, signatures des
      // deux phases présentes.
      expect(texte).toContain("à Paris");
      expect(texte.split("Lu et approuvé — SCI Turgot")).toHaveLength(3);
    });
  });

  describe("envoi", () => {
    it("envoi de l'entrée refusé, sans mail ni trace", async () => {
      await declarerEntreePapier();
      await expect(envoyer("entree")).rejects.toThrow(MESSAGE_ENTREE_PAPIER_SANS_DOCUMENT);
      await expect(envoyer("entree")).rejects.toThrow(ConflictException);
      expect(sendMailMock).not.toHaveBeenCalled();
      expect(
        await db.select().from(etatDesLieuxEnvoi).where(eq(etatDesLieuxEnvoi.etatDesLieuxId, dossier.etatDesLieuxId))
      ).toEqual([]);
    });

    it("sortie : PDF de sortie puis scan d'entrée joints, texte du mail adapté, deux pièces journalisées", async () => {
      await declarerEntreePapier();
      await signerSortie();

      const { resultats } = await envoyer("sortie");

      expect(resultats[0]?.statut).toBe("envoye");
      expect(sendMailMock).toHaveBeenCalledTimes(1);
      const [mail] = sendMailMock.mock.calls[0] as [
        { text: string; attachments: { filename: string; content: Buffer; contentType: string }[] }
      ];
      expect(mail.attachments.map((a) => [a.filename, a.contentType])).toEqual([
        ["etat-des-lieux-sortie.pdf", "application/pdf"],
        [NOM_FICHIER_SCAN_ENTREE_PAPIER, "application/pdf"]
      ]);
      expect(mail.attachments[1]!.content.equals(SCAN)).toBe(true);
      expect(mail.text).toContain(
        "Vous trouverez également ci-joint la copie numérisée de l'état des lieux d'entrée, établi et signé sur papier."
      );

      // Trace de remise : le PDF de sortie, et le scan joint avec l'empreinte
      // des octets exacts de la pièce jointe.
      const [trace] = await db
        .select()
        .from(etatDesLieuxEnvoi)
        .where(eq(etatDesLieuxEnvoi.etatDesLieuxId, dossier.etatDesLieuxId));
      expect(trace?.documentId).toBe((await pdfService.lirePdfFige(dossier.etatDesLieuxId, "sortie"))?.documentId);
      expect(trace?.pdfSha256).toBe(createHash("sha256").update(mail.attachments[0]!.content).digest("hex"));
      const [scanDeclare] = await db
        .select({ documentId: etatDesLieuxEntreePapier.documentId })
        .from(etatDesLieuxEntreePapier)
        .where(eq(etatDesLieuxEntreePapier.etatDesLieuxId, dossier.etatDesLieuxId));
      expect(trace?.scanDocumentId).toBe(scanDeclare?.documentId);
      expect(trace?.scanSha256).toBe(createHash("sha256").update(mail.attachments[1]!.content).digest("hex"));
      expect(trace?.scanSha256).toBe(createHash("sha256").update(SCAN).digest("hex"));
      const historique = await avecContexte(() => envoiService.listerHistorique(dossier.etatDesLieuxId));
      expect(historique[0]?.scanSha256).toBe(trace?.scanSha256);
      const pieces = await db
        .select()
        .from(pieceJointeMessage)
        .where(eq(pieceJointeMessage.messageId, trace!.messageCommunicationId!));
      expect(pieces.map((p) => p.nomFichier).sort()).toEqual(
        ["etat-des-lieux-sortie.pdf", NOM_FICHIER_SCAN_ENTREE_PAPIER].sort()
      );
    });

    it("non-régression : sortie entièrement numérique, une seule pièce jointe, aucune preuve de scan", async () => {
      await avecContexte(() => signatureService.signerEntree(dossier.etatDesLieuxId, dtoSignature({ lieu: "Paris" })));
      await signerSortie();

      await envoyer("sortie");

      const [mail] = sendMailMock.mock.calls[0] as [{ text: string; attachments: { filename: string }[] }];
      expect(mail.attachments.map((a) => a.filename)).toEqual(["etat-des-lieux-sortie.pdf"]);
      expect(mail.text).not.toContain("copie numérisée");
      const [trace] = await db
        .select()
        .from(etatDesLieuxEnvoi)
        .where(eq(etatDesLieuxEnvoi.etatDesLieuxId, dossier.etatDesLieuxId));
      expect(trace?.scanDocumentId).toBeNull();
      expect(trace?.scanSha256).toBeNull();
    });

    it("la base refuse un scan sans empreinte et une empreinte sans scan (CHECK)", async () => {
      await declarerEntreePapier();
      await signerSortie();
      await envoyer("sortie");
      const [trace] = await db
        .select()
        .from(etatDesLieuxEnvoi)
        .where(eq(etatDesLieuxEnvoi.etatDesLieuxId, dossier.etatDesLieuxId));
      for (const valeurs of [{ scanSha256: null }, { scanDocumentId: null }]) {
        await expect(
          db.transaction((tx) =>
            tx.update(etatDesLieuxEnvoi).set(valeurs).where(eq(etatDesLieuxEnvoi.id, trace!.id))
          )
        ).rejects.toThrow(/etat_des_lieux_envoi_scan_coherent|check constraint/);
      }
    });

    it("plafond de taille sur l'ensemble des pièces jointes : refusé au-delà, sans mail ni trace", async () => {
      await declarerEntreePapier();
      await signerSortie();
      const figé = (await pdfService.lirePdfFige(dossier.etatDesLieuxId, "sortie"))!;
      const lire = vi.spyOn(pdfService, "lirePdfFige");

      // PDF seul sous le plafond, mais PDF + scan au-dessus.
      lire.mockResolvedValueOnce({ ...figé, contenu: Buffer.alloc(TAILLE_MAX_PDF_ENVOI_OCTETS - SCAN.length + 1) });
      await expect(envoyer("sortie")).rejects.toThrow(PayloadTooLargeException);
      await expect(
        (async () => {
          lire.mockResolvedValueOnce({ ...figé, contenu: Buffer.alloc(TAILLE_MAX_PDF_ENVOI_OCTETS - SCAN.length + 1) });
          return envoyer("sortie");
        })()
      ).rejects.toThrow(/ensemble trop volumineux/);
      expect(sendMailMock).not.toHaveBeenCalled();

      // Pile au plafond : accepté.
      lire.mockResolvedValueOnce({ ...figé, contenu: Buffer.alloc(TAILLE_MAX_PDF_ENVOI_OCTETS - SCAN.length) });
      const { resultats } = await envoyer("sortie");
      expect(resultats[0]?.statut).toBe("envoye");
    });
  });
});
