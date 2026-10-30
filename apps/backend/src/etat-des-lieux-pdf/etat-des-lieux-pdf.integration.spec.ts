import { randomUUID } from "crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import path from "path";
import { Logger, NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, documents, organisations, utilisateurs, type Database } from "db";
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
import { EtatsDesLieuxSignatureModule } from "../etats-des-lieux-signature/etats-des-lieux-signature.module";
import { EtatsDesLieuxSignatureService } from "../etats-des-lieux-signature/etats-des-lieux-signature.service";
import { EtatsDesLieuxModule } from "../etats-des-lieux/etats-des-lieux.module";
import { EtatsDesLieuxService } from "../etats-des-lieux/etats-des-lieux.service";
import { GotenbergIndisponibleError } from "../gotenberg/gotenberg.errors";
import { GotenbergService } from "../gotenberg/gotenberg.service";
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { EtatDesLieuxPdfJobService } from "./etat-des-lieux-pdf-job.service";
import { EtatDesLieuxPdfModule } from "./etat-des-lieux-pdf.module";
import { EtatDesLieuxPdfService } from "./etat-des-lieux-pdf.service";

// Fixture committée réutilisée telle quelle (même template que les autres
// specs de ce domaine — voir etat-des-lieux-document-docx-signatures.
// integration.spec.ts).
const FIXTURE_TEMPLATE = path.join(
  __dirname,
  "..",
  "etat-des-lieux-document-docx",
  "__fixtures__",
  "modele-etat-des-lieux-test.docx"
);
process.env["ETAT_DES_LIEUX_DOCUMENT_DOCX_TEMPLATE_PATH"] = FIXTURE_TEMPLATE;

// Ce fichier produit lui-même des .docx figés à chaque signerEntree/
// signerSortie (c'est son objet), certains tests signant les deux phases
// — même raison que les autres specs de signature (voir leur commentaire,
// et docs/backlog.md pour la mesure).
vi.setConfig({ testTimeout: 20000 });

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

type ComportementSimulateur =
  | { type: "succes" }
  | { type: "erreur"; statut: number }
  | { type: "attendre"; porte: Promise<void> };

// Simulateur Gotenberg minimal (chantier PDF étape 4, 2026-10-27) : un
// vrai serveur HTTP local, jamais un mock de fetch — exerce tout le
// chemin réel de GotenbergService (multipart, Basic Auth absent ici,
// Content-Type/signature de la réponse). Comportement mutable entre les
// tests (succès/erreur/attente contrôlée), un seul process pour tout le
// fichier (démarré une fois, réutilisé par chaque TestingModule compilé
// dans beforeEach).
function creerSimulateurGotenberg(): Promise<{
  url: string;
  fermer: () => Promise<void>;
  definirComportement: (c: ComportementSimulateur) => void;
  nombreAppels: () => number;
  reinitialiser: () => void;
}> {
  let comportement: ComportementSimulateur = { type: "succes" };
  let appels = 0;
  const serveur: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      if (req.method !== "POST" || req.url !== "/forms/libreoffice/convert") {
        res.writeHead(404).end();
        return;
      }
      appels++;
      // Corps multipart reçu (drainé, jamais parsé — seul le comportement
      // de réponse configuré par le test importe ici) : attend la fin du
      // flux avant de répondre, comme le ferait un vrai appel réseau.
      await new Promise<void>((resolve) => {
        req.resume();
        req.once("end", resolve);
      });
      const c = comportement;
      if (c.type === "attendre") {
        await c.porte;
      }
      if (c.type === "erreur") {
        res.writeHead(c.statut, { "content-type": "text/plain" }).end("erreur simulée");
        return;
      }
      const pdf = Buffer.concat([Buffer.from("%PDF-1.4 "), Buffer.from(`pdf-simule-${appels}`)]);
      res.writeHead(200, { "content-type": "application/pdf" }).end(pdf);
    })();
  });
  return new Promise((resolve) => {
    serveur.listen(0, "127.0.0.1", () => {
      const adresse = serveur.address();
      if (!adresse || typeof adresse === "string") {
        throw new Error("Échec du démarrage du simulateur Gotenberg");
      }
      resolve({
        url: `http://127.0.0.1:${adresse.port}`,
        fermer: () => new Promise((r) => serveur.close(() => r())),
        definirComportement: (c) => {
          comportement = c;
        },
        nombreAppels: () => appels,
        reinitialiser: () => {
          appels = 0;
        }
      });
    });
  });
}

async function attendreCondition(predicat: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const debut = Date.now();
  while (Date.now() - debut < timeoutMs) {
    if (await predicat()) {
      return;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Condition jamais remplie dans le délai imparti");
}

function texteDuDocx(buffer: Buffer): string {
  const zip = new PizZip(buffer);
  const documentXml = zip.files["word/document.xml"];
  if (!documentXml) {
    throw new Error("word/document.xml introuvable dans le .docx généré");
  }
  return [...documentXml.asText().matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("|");
}

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  etatDesLieuxId: string;
  titulaireId: string;
}

describe("EtatDesLieuxPdfService — génération et stockage découplés après signature (intégration Postgres réelle, Gotenberg simulé)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  // Capturé une seule fois, avant toute modification — restauré dans
  // afterAll ci-dessous, quelle que soit sa valeur d'origine (définie ou
  // non). Un seul simulateur pour tout le fichier (beforeAll/afterAll,
  // jamais par test) : évite l'ouverture/fermeture d'un port à chaque
  // test et la fenêtre de fuite que ça ouvrirait vers un autre fichier
  // exécuté dans le même worker Vitest.
  const GOTENBERG_URL_ORIGINAL = process.env["GOTENBERG_URL"];
  let simulateur: Awaited<ReturnType<typeof creerSimulateurGotenberg>>;

  let moduleRef: TestingModule;
  let db: Database;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let locatairesService: LocatairesService;
  let bauxService: BauxService;
  let bailLocatairesService: BailLocatairesService;
  let etatsDesLieuxService: EtatsDesLieuxService;
  let etatsDesLieuxSignatureService: EtatsDesLieuxSignatureService;
  let etatDesLieuxPdfService: EtatDesLieuxPdfService;
  let etatDesLieuxPdfJobService: EtatDesLieuxPdfJobService;
  let gotenbergService: GotenbergService;
  let documentsService: DocumentsService;
  let requestContextService: RequestContextService;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation EDL Pdf ${suffixe}` })
      .returning();
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation!.id,
        email: `edl-pdf-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `EdlPdf${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    const userId = user!.id;

    const sci = await scisService.create(userId, {
      nom: `SCI EDL Pdf ${suffixe}`,
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: `Immeuble EDL Pdf ${suffixe}`,
      adresse: "1 rue des Pdf",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: suffixe,
      type: "T2",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    await appartementsService.update(appartement.id, { nombreChambres: 1, nombreSallesDeBain: 1, nombreWc: 1 });
    const titulaire = await locatairesService.create(userId, { nom: "Dupont", prenom: `Jean${suffixe}` });
    const bail = await bauxService.create({
      appartementId: appartement.id,
      typeBail: "vide",
      dateDebut: "2026-08-01",
      loyerMensuel: "650.00",
      depotGarantie: "650.00",
      provisionsCharges: "30.00",
      jourEcheance: 5
    });
    await bailLocatairesService.create({ bailId: bail.id, locataireId: titulaire.id, role: "titulaire" });
    const etatDesLieux = await etatsDesLieuxService.create({ bailId: bail.id });

    return { organisationId: organisation!.id, userId, etatDesLieuxId: etatDesLieux.id, titulaireId: titulaire.id };
  }

  function dtoSignature(locataireIds: string[], overrides: Record<string, unknown> = {}) {
    return {
      bailleur: { nomAffiche: "Jimmy Ettori", luEtApprouve: true, imagePng: PNG_1X1_BASE64 },
      locataires: locataireIds.map((locataireId) => ({ locataireId, luEtApprouve: true, imagePng: PNG_1X1_BASE64 })),
      ...overrides
    };
  }

  async function docFige(etatDesLieuxId: string, phase: "entree" | "sortie", categorie: "etat_des_lieux_docx" | "etat_des_lieux_pdf") {
    const [ligne] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.entiteId, etatDesLieuxId), eq(documents.categorie, categorie), eq(documents.etatDesLieuxPhase, phase)));
    return ligne ?? null;
  }

  beforeAll(async () => {
    simulateur = await creerSimulateurGotenberg();
    process.env["GOTENBERG_URL"] = simulateur.url;
  });

  beforeEach(async () => {
    simulateur.definirComportement({ type: "succes" });
    // nombreAppels() est un compteur cumulatif côté simulateur (un seul
    // process pour tout le fichier, voir beforeAll) — sans cette remise à
    // zéro, un test vérifiant "jamais appelé" ou "attends le prochain
    // appel" se fierait au compte laissé par les tests précédents, pas au
    // sien.
    simulateur.reinitialiser();

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
        EtatDesLieuxPdfModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    locatairesService = moduleRef.get(LocatairesService);
    bauxService = moduleRef.get(BauxService);
    bailLocatairesService = moduleRef.get(BailLocatairesService);
    etatsDesLieuxService = moduleRef.get(EtatsDesLieuxService);
    etatsDesLieuxSignatureService = moduleRef.get(EtatsDesLieuxSignatureService);
    etatDesLieuxPdfService = moduleRef.get(EtatDesLieuxPdfService);
    etatDesLieuxPdfJobService = moduleRef.get(EtatDesLieuxPdfJobService);
    gotenbergService = moduleRef.get(GotenbergService);
    documentsService = moduleRef.get(DocumentsService);
    requestContextService = moduleRef.get(RequestContextService);
  });

  afterEach(async () => {
    // Chaque test ci-dessus attend déjà explicitement la fin de ce qu'il
    // déclenche (attendreCondition) — cet appel est un filet
    // supplémentaire, attente déterministe plutôt qu'un délai fixe
    // arbitraire, avant de fermer le module et de faire le rollback
    // (même raison que les autres specs de signature : une seule
    // connexion/transaction Postgres réutilisée pour tout le fichier).
    await etatDesLieuxPdfService.attendreTachesEnCours();
    await moduleRef?.close();
    await rollback();
    // Restaure tout vi.spyOn posé par un test (Logger.prototype.warn/error,
    // gotenbergService.estConfigure/convertirDocxEnPdf) — Logger.prototype
    // est un prototype PARTAGÉ par tout le process, jamais réinitialisé
    // par moduleRef.close() : sans cette restauration, un espion posé par
    // un test fuirait vers tous les tests suivants, y compris dans
    // d'autres fichiers exécutés par le même worker Vitest (même risque
    // que la fuite de GOTENBERG_URL via process.env, voir afterAll
    // ci-dessous).
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await rootDb.$client.end();
    await simulateur.fermer();
    // Jamais de fuite de GOTENBERG_URL vers un autre fichier de test
    // exécuté dans le même worker Vitest ensuite (pool "threads"/"forks" :
    // process.env est un global partagé entre fichiers réutilisant le même
    // worker) — restaure exactement l'état précédent, qu'il soit défini ou
    // non.
    if (GOTENBERG_URL_ORIGINAL === undefined) {
      delete process.env["GOTENBERG_URL"];
    } else {
      process.env["GOTENBERG_URL"] = GOTENBERG_URL_ORIGINAL;
    }
  });

  function avecContexte<T>(fixture: FixtureOrganisation, fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte({ utilisateurId: fixture.userId, organisationId: fixture.organisationId }, fn);
  }

  it("signature → .docx figé puis PDF stockés, catégories et phase correctes", async () => {
    const orgA = await creerFixtureOrganisation("A1");
    await avecContexte(orgA, () => etatsDesLieuxSignatureService.signerEntree(orgA.etatDesLieuxId, dtoSignature([orgA.titulaireId])));

    await attendreCondition(async () => (await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf")) !== null);

    const docx = await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_docx");
    const pdf = await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf");
    expect(docx?.estEtatDesLieuxFige).toBe(true);
    expect(pdf?.estEtatDesLieuxFige).toBe(true);
    expect(docx?.mimeType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(pdf?.mimeType).toBe("application/pdf");
  });

  it("la réponse de signature n'attend ni le .docx figé ni le PDF (chaîne entière en arrière-plan)", async () => {
    const orgA = await creerFixtureOrganisation("A2");
    let libererPorte!: () => void;
    const porte = new Promise<void>((resolve) => {
      libererPorte = resolve;
    });
    // La porte ne bloque que l'étape PDF (c'est le simulateur Gotenberg) —
    // le .docx, local et sans réseau, se termine de toute façon avant que
    // la chaîne n'atteigne cette porte. La preuve qu'il n'est PAS attendu
    // par la réponse de signature vient de la vérification immédiatement
    // après signerEntree ci-dessous, pas de ce simulateur.
    simulateur.definirComportement({ type: "attendre", porte });

    // try/finally : la porte doit TOUJOURS être libérée, même si une
    // assertion échoue ci-dessous — sinon le simulateur (partagé pour
    // tout le fichier, voir beforeAll) reste bloqué pour les tests
    // suivants.
    try {
      const resultat = await avecContexte(orgA, () =>
        etatsDesLieuxSignatureService.signerEntree(orgA.etatDesLieuxId, dtoSignature([orgA.titulaireId]))
      );
      expect(resultat?.entreeSigneeParTous).toBe(true);

      // La réponse de signature est revenue alors que ni le .docx
      // (local, pas de réseau) ni le PDF n'existent encore — toute la
      // chaîne (docx PUIS pdf, chantier PDF étape 4, 2026-10-30) tourne
      // en arrière-plan, jamais attendue par cette réponse.
      expect(await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_docx")).toBeNull();
      expect(await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf")).toBeNull();
    } finally {
      libererPorte();
    }
    await attendreCondition(async () => (await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf")) !== null);
    expect(await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_docx")).not.toBeNull();
  });

  it("si le .docx figé échoue, le PDF n'est jamais tenté (chaîne arrêtée à la première étape en échec)", async () => {
    const orgA = await creerFixtureOrganisation("A2b");
    // Appel direct de la chaîne (pas via signerEntree) sur un état des
    // lieux dont dateEntree n'est pas encore posée : genererDocumentEtatDesLieuxDocx
    // refuse ("L'entrée doit être terminée...") avant même de lire quoi
    // que ce soit d'autre — échec déterministe du .docx, sans corrompre
    // de données métier pour le provoquer.
    await avecContexte(orgA, () => etatDesLieuxPdfService.produireDocumentsFigesEnArrierePlan(orgA.etatDesLieuxId, "entree"));

    expect(await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_docx")).toBeNull();
    expect(await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf")).toBeNull();
    expect(simulateur.nombreAppels()).toBe(0);
  });

  it("la chaîne en arrière-plan ne produit jamais de promesse rejetée non gérée (docx réussi, PDF en échec)", async () => {
    const rejectionsNonGerees: unknown[] = [];
    const surRejetNonGere = (raison: unknown) => rejectionsNonGerees.push(raison);
    process.on("unhandledRejection", surRejetNonGere);

    try {
      const orgA = await creerFixtureOrganisation("A2c");
      simulateur.definirComportement({ type: "erreur", statut: 500 });

      await avecContexte(orgA, () =>
        etatsDesLieuxSignatureService.signerEntree(orgA.etatDesLieuxId, dtoSignature([orgA.titulaireId]))
      );
      await attendreCondition(async () => simulateur.nombreAppels() >= 1);
      // Laisse la chaîne se terminer (son échec PDF est déjà consommé par
      // son propre try/catch interne — rien à attendre ici d'autre qu'un
      // délai de grâce avant de conclure).
      await new Promise((r) => setTimeout(r, 200));
    } finally {
      process.off("unhandledRejection", surRejetNonGere);
    }

    expect(rejectionsNonGerees).toEqual([]);
  });

  it("simulateur en erreur → signature intacte, .docx figé présent, PDF absent", async () => {
    const orgA = await creerFixtureOrganisation("A3");
    simulateur.definirComportement({ type: "erreur", statut: 500 });

    const resultat = await avecContexte(orgA, () =>
      etatsDesLieuxSignatureService.signerEntree(orgA.etatDesLieuxId, dtoSignature([orgA.titulaireId]))
    );
    expect(resultat?.entreeSigneeParTous).toBe(true);

    await attendreCondition(async () => simulateur.nombreAppels() >= 1);
    // Laisse le temps à la promesse en arrière-plan de se résoudre (ou pas)
    // avant de conclure à l'absence définitive du PDF.
    await new Promise((r) => setTimeout(r, 100));

    expect(await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_docx")).not.toBeNull();
    expect(await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf")).toBeNull();

    // L'endpoint manuel rattrape ensuite, une fois Gotenberg de nouveau sain.
    simulateur.definirComportement({ type: "succes" });
    await avecContexte(orgA, () => etatDesLieuxPdfService.produireManuellement(orgA.etatDesLieuxId, "entree"));
    expect(await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf")).not.toBeNull();
  });

  it("double appel manuel → un seul document figé par phase (course réglée par l'index unique)", async () => {
    const orgA = await creerFixtureOrganisation("A4");
    await avecContexte(orgA, () => etatsDesLieuxSignatureService.signerEntree(orgA.etatDesLieuxId, dtoSignature([orgA.titulaireId])));
    await attendreCondition(async () => (await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf")) !== null);

    // Deux appels manuels successifs, après que tout existe déjà : chacun
    // doit rester un no-op, jamais une nouvelle ligne.
    await avecContexte(orgA, () => etatDesLieuxPdfService.produireManuellement(orgA.etatDesLieuxId, "entree"));
    await avecContexte(orgA, () => etatDesLieuxPdfService.produireManuellement(orgA.etatDesLieuxId, "entree"));

    const docxLignes = await db
      .select()
      .from(documents)
      .where(and(eq(documents.entiteId, orgA.etatDesLieuxId), eq(documents.categorie, "etat_des_lieux_docx")));
    const pdfLignes = await db
      .select()
      .from(documents)
      .where(and(eq(documents.entiteId, orgA.etatDesLieuxId), eq(documents.categorie, "etat_des_lieux_pdf")));
    expect(docxLignes).toHaveLength(1);
    expect(pdfLignes).toHaveLength(1);
  });

  it("PDF d'entrée inchangé après la signature de sortie (jamais régénéré)", async () => {
    const orgA = await creerFixtureOrganisation("A5");
    await avecContexte(orgA, () => etatsDesLieuxSignatureService.signerEntree(orgA.etatDesLieuxId, dtoSignature([orgA.titulaireId])));
    await attendreCondition(async () => (await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf")) !== null);
    const pdfEntreeAvant = await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf");

    await avecContexte(orgA, () => etatsDesLieuxSignatureService.signerSortie(orgA.etatDesLieuxId, dtoSignature([orgA.titulaireId])));
    await attendreCondition(async () => (await docFige(orgA.etatDesLieuxId, "sortie", "etat_des_lieux_pdf")) !== null);

    const pdfEntreeApres = await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf");
    expect(pdfEntreeApres?.id).toBe(pdfEntreeAvant?.id);
    expect(pdfEntreeApres?.cheminStockage).toBe(pdfEntreeAvant?.cheminStockage);
  });

  it("le .docx figé d'entrée ne contient aucune donnée de sortie, même saisie avant la signature", async () => {
    const orgA = await creerFixtureOrganisation("A6");
    // 70319 : valeur arbitraire et distinctive, jamais un nombre qui
    // pourrait apparaître ailleurs dans le document (date, etc.) —
    // description/etatEntree sont des champs COMMUNS (non vidés par
    // avecSortie=false, ils décrivent le logement tel que constaté à
    // l'entrée) : seule nombreSortie (clé contenant "Sortie") doit
    // disparaître.
    const NOMBRE_SORTIE_DISTINCTIF = "70319";
    await avecContexte(orgA, () =>
      etatsDesLieuxService.submitEquipementsDivers(orgA.etatDesLieuxId, {
        lignes: [{ libelle: "Détecteur de test", nombreEntree: 1, nombreSortie: Number(NOMBRE_SORTIE_DISTINCTIF) }]
      })
    );

    await avecContexte(orgA, () => etatsDesLieuxSignatureService.signerEntree(orgA.etatDesLieuxId, dtoSignature([orgA.titulaireId])));

    // Le .docx figé est désormais produit en arrière-plan (chaîne unique,
    // 2026-10-30) — jamais disponible immédiatement après signerEntree.
    await attendreCondition(async () => (await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_docx")) !== null);
    const docx = await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_docx");
    expect(docx).not.toBeNull();
    const { contenu } = await avecContexte(orgA, () => documentsService.telecharger(docx!.id));
    expect(texteDuDocx(contenu)).not.toContain(NOMBRE_SORTIE_DISTINCTIF);

    await attendreCondition(async () => (await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf")) !== null);
  });

  it("endpoint manuel : refuse si la phase n'est pas signée", async () => {
    const orgA = await creerFixtureOrganisation("A7");
    await expect(avecContexte(orgA, () => etatDesLieuxPdfService.produireManuellement(orgA.etatDesLieuxId, "entree"))).rejects.toThrow(
      /n'est pas signée/
    );
  });

  it("listerDocumentsFiges : reflète correctement présence/absence par phase", async () => {
    const orgA = await creerFixtureOrganisation("A8");
    const avant = await avecContexte(orgA, () => etatDesLieuxPdfService.listerDocumentsFiges(orgA.etatDesLieuxId));
    expect(avant).toEqual([
      { phase: "entree", docx: null, pdf: null },
      { phase: "sortie", docx: null, pdf: null }
    ]);

    await avecContexte(orgA, () => etatsDesLieuxSignatureService.signerEntree(orgA.etatDesLieuxId, dtoSignature([orgA.titulaireId])));
    await attendreCondition(async () => (await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf")) !== null);

    const apres = await avecContexte(orgA, () => etatDesLieuxPdfService.listerDocumentsFiges(orgA.etatDesLieuxId));
    const entree = apres.find((l) => l.phase === "entree")!;
    const sortie = apres.find((l) => l.phase === "sortie")!;
    expect(entree.docx).not.toBeNull();
    expect(entree.pdf).not.toBeNull();
    expect(sortie.docx).toBeNull();
    expect(sortie.pdf).toBeNull();
  });

  describe("relance (job planifié + relance à la lecture, chantier PDF étape 4b)", () => {
    it("trouverPhasesSigneesIncompletes : retrouve une phase signée dont un document figé manque, ignore une phase non signée ou déjà complète", async () => {
      const orgA = await creerFixtureOrganisation("J1");
      const orgB = await creerFixtureOrganisation("J2");

      // orgA : signature d'entrée avec Gotenberg en échec -> .docx présent, PDF absent (candidate).
      // Attend explicitement que l'appel Gotenberg ait eu lieu ET échoué (pas seulement le .docx,
      // local et plus rapide) avant de rebasculer le simulateur en succès pour orgB ci-dessous :
      // sinon la tentative PDF d'orgA, encore en vol, pourrait réussir sur le comportement devenu
      // "succès" (simulateur partagé pour tout le fichier, voir creerSimulateurGotenberg) et fausser
      // ce test — même raison que le délai de grâce du test "simulateur en erreur" plus haut.
      simulateur.definirComportement({ type: "erreur", statut: 500 });
      await avecContexte(orgA, () => etatsDesLieuxSignatureService.signerEntree(orgA.etatDesLieuxId, dtoSignature([orgA.titulaireId])));
      await attendreCondition(async () => simulateur.nombreAppels() >= 1);
      await new Promise((r) => setTimeout(r, 100));
      expect(await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf")).toBeNull();

      // orgB : signature d'entrée avec Gotenberg sain -> phase complète, jamais candidate. Sa phase
      // sortie n'est, elle, jamais signée -> pas candidate non plus (aucune signature bailleur).
      simulateur.reinitialiser();
      simulateur.definirComportement({ type: "succes" });
      await avecContexte(orgB, () => etatsDesLieuxSignatureService.signerEntree(orgB.etatDesLieuxId, dtoSignature([orgB.titulaireId])));
      await attendreCondition(async () => (await docFige(orgB.etatDesLieuxId, "entree", "etat_des_lieux_pdf")) !== null);

      // Égalité stricte sur le tableau entier, pas une simple inclusion : cette requête est
      // volontairement système (toutes organisations, voir son commentaire), mais sous
      // pnpm test:integration:clean — seule façon sanctionnée de lancer cette suite, voir
      // CLAUDE.md et scripts/test-integration-clean.mjs (down -v puis up -d avant ET après,
      // DATABASE_URL forcée sur localhost:5434, jamais 5433) — la base est entièrement vide à
      // chaque lancement, puis remise à zéro par ROLLBACK entre chaque test
      // (createTransactionalTestHooks) : aucune autre signature bailleur ne peut exister au
      // moment de cet appel que celles créées ci-dessus. Lancer ce fichier directement contre
      // le Postgres de dev (pnpm --filter backend test:integration, sans :clean — possible via
      // le repli DEFAULT_DEV_DATABASE_URL, voir packages/db/src/client.ts) sortirait de ce
      // contrat ; ce n'est jamais le cas en CI ni dans le pipeline attendu avant un commit.
      const incomplets = await etatDesLieuxPdfService.trouverPhasesSigneesIncompletes();
      expect(incomplets).toEqual([{ etatDesLieuxId: orgA.etatDesLieuxId, phase: "entree" }]);
    });

    it("le job planifié (EtatDesLieuxPdfJobService) rattrape le PDF manquant d'une phase signée", async () => {
      const orgA = await creerFixtureOrganisation("J3");
      simulateur.definirComportement({ type: "erreur", statut: 500 });
      await avecContexte(orgA, () => etatsDesLieuxSignatureService.signerEntree(orgA.etatDesLieuxId, dtoSignature([orgA.titulaireId])));
      // Attend que la tentative PDF ait réellement eu lieu ET échoué (pas seulement le .docx) avant
      // de rebasculer le simulateur en succès ci-dessous — même raison que le test précédent.
      await attendreCondition(async () => simulateur.nombreAppels() >= 1);
      await new Promise((r) => setTimeout(r, 100));
      expect(await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf")).toBeNull();

      simulateur.reinitialiser();
      simulateur.definirComportement({ type: "succes" });

      // Appel réel de bout en bout, requête système trouverPhasesSigneesIncompletes comprise
      // (jamais simulée) : sûr uniquement sous pnpm test:integration:clean, qui recrée la base
      // entièrement vide à chaque lancement (voir le commentaire du test précédent) — aucun
      // autre état des lieux réel ne peut s'y trouver mêlé.
      await etatDesLieuxPdfJobService.rattraperDocumentsManquants();

      expect(await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf")).not.toBeNull();
    });

    it("listerDocumentsFiges déclenche un rattrapage en arrière-plan pour une phase signée incomplète, sans bloquer la lecture", async () => {
      const orgA = await creerFixtureOrganisation("J4");
      simulateur.definirComportement({ type: "erreur", statut: 500 });
      await avecContexte(orgA, () => etatsDesLieuxSignatureService.signerEntree(orgA.etatDesLieuxId, dtoSignature([orgA.titulaireId])));
      // Attend que la tentative PDF ait réellement eu lieu ET échoué (pas seulement le .docx) avant
      // de rebasculer le simulateur en succès ci-dessous — même raison que les deux tests précédents.
      await attendreCondition(async () => simulateur.nombreAppels() >= 1);
      await new Promise((r) => setTimeout(r, 100));
      expect(await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf")).toBeNull();

      simulateur.reinitialiser();
      simulateur.definirComportement({ type: "succes" });
      const avant = await avecContexte(orgA, () => etatDesLieuxPdfService.listerDocumentsFiges(orgA.etatDesLieuxId));
      // La lecture elle-même reflète encore l'état constaté à cet instant (PDF absent) — c'est le
      // rattrapage qu'elle vient de déclencher en arrière-plan qui le produira, jamais la lecture
      // elle-même (même preuve de non-blocage que pour signerEntree, voir plus haut).
      expect(avant.find((l) => l.phase === "entree")?.pdf).toBeNull();

      await attendreCondition(async () => (await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf")) !== null);
    });

    it("pas de double lancement : deux déclencheurs concurrents pour le même (état des lieux, phase) rejoignent la même tâche", async () => {
      const orgA = await creerFixtureOrganisation("D1");
      let libererPorte!: () => void;
      const porte = new Promise<void>((resolve) => {
        libererPorte = resolve;
      });
      simulateur.definirComportement({ type: "attendre", porte });

      try {
        await avecContexte(orgA, () =>
          etatsDesLieuxSignatureService.signerEntree(orgA.etatDesLieuxId, dtoSignature([orgA.titulaireId]))
        );
        // La chaîne de signature est en cours, bloquée à l'étape PDF par la porte — le .docx
        // (local, sans réseau) est déjà là.
        await attendreCondition(async () => (await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_docx")) !== null);

        // Deux autres déclencheurs pour EXACTEMENT le même couple pendant que la première chaîne
        // tourne encore (job planifié, relance à la lecture) : doivent rejoindre la MÊME
        // promesse que celle déjà posée par signerEntree, jamais en lancer une nouvelle.
        const rattrapage = etatDesLieuxPdfService.rattraperDocumentsManquantsEnArrierePlan(orgA.etatDesLieuxId, "entree");
        const secondAppelSignature = etatDesLieuxPdfService.produireDocumentsFigesEnArrierePlan(orgA.etatDesLieuxId, "entree");
        expect(rattrapage).toBe(secondAppelSignature);

        libererPorte();
        await rattrapage;
      } finally {
        libererPorte();
      }

      // Un seul appel Gotenberg au total, malgré 3 déclencheurs pour le même couple.
      expect(simulateur.nombreAppels()).toBe(1);
      expect(await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf")).not.toBeNull();
    });

    it("endpoint manuel : rejoint une chaîne déjà en cours pour le même (état des lieux, phase) plutôt que d'en lancer une seconde", async () => {
      const orgA = await creerFixtureOrganisation("D2");
      let libererPorte!: () => void;
      const porte = new Promise<void>((resolve) => {
        libererPorte = resolve;
      });
      simulateur.definirComportement({ type: "attendre", porte });

      try {
        await avecContexte(orgA, () =>
          etatsDesLieuxSignatureService.signerEntree(orgA.etatDesLieuxId, dtoSignature([orgA.titulaireId]))
        );
        await attendreCondition(async () => (await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_docx")) !== null);

        // Appel manuel PENDANT que la chaîne de signature est encore bloquée à l'étape PDF
        // (porte non libérée) : doit la rejoindre, jamais lancer sa propre tentative concurrente
        // de conversion.
        const appelManuel = avecContexte(orgA, () => etatDesLieuxPdfService.produireManuellement(orgA.etatDesLieuxId, "entree"));
        libererPorte();
        await appelManuel;
      } finally {
        libererPorte();
      }

      expect(simulateur.nombreAppels()).toBe(1);
      expect(await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf")).not.toBeNull();
    });

    it("Gotenberg non configuré : le .docx figé est quand même produit, aucun log répété à chaque relance", async () => {
      const orgA = await creerFixtureOrganisation("L1");
      // GOTENBERG_URL reste définie (process.env, voir beforeAll) — on simule directement
      // "non configuré" via estConfigure(), sans recompiler tout le module pour une variable
      // d'environnement : GotenbergService journalise déjà lui-même un WARN unique à son
      // propre démarrage dans ce cas (voir gotenberg.service.ts) — rien à répéter ici.
      vi.spyOn(gotenbergService, "estConfigure").mockReturnValue(false);
      vi.spyOn(gotenbergService, "convertirDocxEnPdf").mockRejectedValue(new GotenbergIndisponibleError());

      const warnSpy = vi.spyOn(Logger.prototype, "warn");
      const errorSpy = vi.spyOn(Logger.prototype, "error");

      await avecContexte(orgA, () =>
        etatsDesLieuxSignatureService.signerEntree(orgA.etatDesLieuxId, dtoSignature([orgA.titulaireId]))
      );
      await attendreCondition(async () => (await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_docx")) !== null);
      await etatDesLieuxPdfService.attendreTachesEnCours();

      expect(await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_docx")).not.toBeNull();
      expect(await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf")).toBeNull();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();

      // Rattrapage immédiat (job planifié ou relance à la lecture) : toujours aucun log, même à
      // la seconde tentative — jamais une répétition du warning à chaque passage.
      await etatDesLieuxPdfService.rattraperDocumentsManquantsEnArrierePlan(orgA.etatDesLieuxId, "entree");
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("Gotenberg configuré mais transitoirement indisponible (502/503/504 ou réseau) : WARN, jamais ERROR", async () => {
      const orgA = await creerFixtureOrganisation("L2");
      simulateur.definirComportement({ type: "erreur", statut: 503 });

      const warnSpy = vi.spyOn(Logger.prototype, "warn");
      const errorSpy = vi.spyOn(Logger.prototype, "error");

      await avecContexte(orgA, () =>
        etatsDesLieuxSignatureService.signerEntree(orgA.etatDesLieuxId, dtoSignature([orgA.titulaireId]))
      );
      await attendreCondition(async () => simulateur.nombreAppels() >= 1);
      await etatDesLieuxPdfService.attendreTachesEnCours();

      expect(await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf")).toBeNull();
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(orgA.etatDesLieuxId));
    });

    it("GotenbergConversionError (échec non transitoire) : ERROR visible dans Cockpit, avec l'id de l'état des lieux et la phase", async () => {
      const orgA = await creerFixtureOrganisation("L3");
      // 500 n'est pas dans CODES_HTTP_RELANCABLES (gotenberg.service.ts) -> GotenbergConversionError,
      // jamais GotenbergIndisponibleError (voir aussi le test "simulateur en erreur" plus haut).
      simulateur.definirComportement({ type: "erreur", statut: 500 });

      const warnSpy = vi.spyOn(Logger.prototype, "warn");
      const errorSpy = vi.spyOn(Logger.prototype, "error");

      await avecContexte(orgA, () =>
        etatsDesLieuxSignatureService.signerEntree(orgA.etatDesLieuxId, dtoSignature([orgA.titulaireId]))
      );
      await attendreCondition(async () => simulateur.nombreAppels() >= 1);
      await etatDesLieuxPdfService.attendreTachesEnCours();

      expect(await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf")).toBeNull();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(`(entree) pour l'état des lieux ${orgA.etatDesLieuxId}`));
    });
  });

  describe("contrôle d'organisation (fail-closed)", () => {
    it("produireManuellement : refuse (404) sur l'état des lieux d'une autre organisation", async () => {
      const orgA = await creerFixtureOrganisation("A9");
      const orgB = await creerFixtureOrganisation("B9");
      await avecContexte(orgA, () => etatsDesLieuxSignatureService.signerEntree(orgA.etatDesLieuxId, dtoSignature([orgA.titulaireId])));
      await attendreCondition(async () => (await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf")) !== null);

      await expect(
        avecContexte(orgB, () => etatDesLieuxPdfService.produireManuellement(orgA.etatDesLieuxId, "sortie"))
      ).rejects.toThrow(NotFoundException);
    });

    it("listerDocumentsFiges : refuse (404) sur l'état des lieux d'une autre organisation", async () => {
      const orgA = await creerFixtureOrganisation("A10");
      const orgB = await creerFixtureOrganisation("B10");
      await expect(avecContexte(orgB, () => etatDesLieuxPdfService.listerDocumentsFiges(orgA.etatDesLieuxId))).rejects.toThrow(
        NotFoundException
      );
    });

    it("telechargerPdf : refuse (404) sur l'état des lieux d'une autre organisation", async () => {
      const orgA = await creerFixtureOrganisation("A11");
      const orgB = await creerFixtureOrganisation("B11");
      await avecContexte(orgA, () => etatsDesLieuxSignatureService.signerEntree(orgA.etatDesLieuxId, dtoSignature([orgA.titulaireId])));
      await attendreCondition(async () => (await docFige(orgA.etatDesLieuxId, "entree", "etat_des_lieux_pdf")) !== null);

      await expect(avecContexte(orgB, () => etatDesLieuxPdfService.telechargerPdf(orgA.etatDesLieuxId, "entree"))).rejects.toThrow(
        NotFoundException
      );
    });
  });
});
