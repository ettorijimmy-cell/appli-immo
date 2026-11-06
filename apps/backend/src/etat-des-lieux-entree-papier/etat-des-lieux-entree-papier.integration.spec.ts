import { randomUUID } from "crypto";
import { rm } from "fs/promises";
import os from "os";
import path from "path";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { phaseSigneeNumeriquement, phasesDepuisEtatDesLieux, TAILLE_MAX_SCAN_ENTREE_PAPIER_OCTETS } from "core";
import {
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  documents,
  etatDesLieuxEntreePapier,
  etatDesLieuxSignature,
  etatsDesLieux,
  organisations,
  utilisateurs,
  type Database
} from "db";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { dateDuJourParis } from "../common/date-paris";
import { RequestContextService } from "../common/request-context";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { DocumentsModule } from "../documents/documents.module";
import { DocumentsService } from "../documents/documents.service";
import { MESSAGE_ENTREE_DECLAREE_PAPIER } from "../etats-des-lieux-signature/etats-des-lieux-signature.service";
import { EtatsDesLieuxSignatureModule } from "../etats-des-lieux-signature/etats-des-lieux-signature.module";
import { EtatsDesLieuxSignatureService } from "../etats-des-lieux-signature/etats-des-lieux-signature.service";
import { resoudrePhaseEtatDesLieuxCourante } from "../etats-des-lieux-signature/resoudre-phase-etat-des-lieux";
import { EtatsDesLieuxModule } from "../etats-des-lieux/etats-des-lieux.module";
import { EtatsDesLieuxService } from "../etats-des-lieux/etats-des-lieux.service";
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { EtatDesLieuxEntreePapierModule } from "./etat-des-lieux-entree-papier.module";
import {
  EtatDesLieuxEntreePapierService,
  MESSAGE_ENTREE_SIGNEE_NUMERIQUEMENT,
  MESSAGE_SCAN_OBLIGATOIRE,
  MESSAGE_SORTIE_SIGNEE
} from "./etat-des-lieux-entree-papier.service";

// Même motif que verrou-signature-etat-des-lieux.integration.spec.ts : une
// signature lance la chaîne docx/PDF d'arrière-plan sur la connexion
// unique du test.
vi.setConfig({ testTimeout: 20000 });

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const ADRESSE_SORTIE = "9 rue du Départ, 69001 Lyon";

function scanPdf(texte = "scan"): { nomFichier: string; contenu: Buffer } {
  return { nomFichier: "entree-papier.pdf", contenu: Buffer.from(`%PDF-1.4\n% ${texte}\n%%EOF\n`) };
}

// Déclaration d'une entrée d'état des lieux établie sur papier
// (2026-11-06) : refus, cas nominal, correction, exclusion mutuelle avec la
// signature numérique, garanties portées par la base.
describe("État des lieux — entrée papier (intégration Postgres réelle)", () => {
  const storageDirTest = path.join(os.tmpdir(), `appli-immo-test-entree-papier-${randomUUID()}`);
  process.env["DOCUMENTS_STORAGE_DIR"] = storageDirTest;

  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let locatairesService: LocatairesService;
  let bauxService: BauxService;
  let bailLocatairesService: BailLocatairesService;
  let etatsDesLieuxService: EtatsDesLieuxService;
  let documentsService: DocumentsService;
  let signatureService: EtatsDesLieuxSignatureService;
  let entreePapierService: EtatDesLieuxEntreePapierService;
  let requestContextService: RequestContextService;
  let organisationId: string;
  let userId: string;

  async function creerOrganisationEtUtilisateur(libelle: string): Promise<{ organisationId: string; userId: string }> {
    const [organisation] = await db.insert(organisations).values({ type: "particulier", nom: libelle }).returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `entree-papier-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Papier",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    return { organisationId: organisation.id, userId: user.id };
  }

  function avecContexte<T>(fn: () => T, contexte = { utilisateurId: userId, organisationId }): T {
    return requestContextService.executerAvecContexte(contexte, fn);
  }

  // Bail du 2026-08-01, deux locataires actifs (Claire Martin, Paul Durand).
  async function creerDossier() {
    const sci = await scisService.create(userId, {
      nom: "SCI Papier Test",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Papier Test",
      adresse: "1 rue du Papier",
      codePostal: "69001",
      ville: "Lyon",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: "1",
      type: "T2",
      nombrePiecesPrincipales: 2,
      modeChauffage: "individuel",
      modeEauChaude: "individuel",
      loyerReference: "700.00"
    });
    await appartementsService.update(appartement.id, { nombreChambres: 1, nombreSallesDeBain: 1, nombreWc: 1 });
    const claire = await locatairesService.create(userId, { nom: "Martin", prenom: "Claire" });
    const paul = await locatairesService.create(userId, { nom: "Durand", prenom: "Paul" });
    const bail = await bauxService.create({
      appartementId: appartement.id,
      typeBail: "vide",
      dateDebut: "2026-08-01",
      loyerMensuel: "650.00",
      depotGarantie: "650.00",
      provisionsCharges: "30.00",
      jourEcheance: 5
    });
    await bailLocatairesService.create({ bailId: bail.id, locataireId: claire.id, role: "titulaire" });
    await bailLocatairesService.create({ bailId: bail.id, locataireId: paul.id, role: "colocataire" });
    const etatDesLieux = await avecContexte(() => etatsDesLieuxService.create({ bailId: bail.id }));
    return { bailId: bail.id, etatDesLieuxId: etatDesLieux.id, claireId: claire.id, paulId: paul.id };
  }

  function dtoPapier(locataireIds: string[], surcharge: Partial<{ dateSignature: string; lieu: string; bailleurNom: string }> = {}) {
    return { dateSignature: "2026-08-01", lieu: "Lyon", bailleurNom: "SCI Papier Test", locataireIds, ...surcharge };
  }

  function dtoSignature(locataireIds: string[], sortie = false) {
    return {
      bailleur: { nomAffiche: "Bailleur Test", luEtApprouve: true, imagePng: PNG_1X1_BASE64 },
      locataires: locataireIds.map((locataireId) => ({ locataireId, luEtApprouve: true, imagePng: PNG_1X1_BASE64 })),
      ...(sortie && { nouvelleAdresseLocataire: ADRESSE_SORTIE })
    };
  }

  function declarer(etatDesLieuxId: string, locataireIds: string[], surcharge = {}, scan = scanPdf()) {
    return avecContexte(() => entreePapierService.declarer(etatDesLieuxId, dtoPapier(locataireIds, surcharge), scan));
  }

  async function lignesPapier(etatDesLieuxId: string) {
    return db
      .select()
      .from(etatDesLieuxEntreePapier)
      .where(eq(etatDesLieuxEntreePapier.etatDesLieuxId, etatDesLieuxId));
  }

  async function scans(etatDesLieuxId: string) {
    return db
      .select()
      .from(documents)
      .where(and(eq(documents.entiteId, etatDesLieuxId), eq(documents.categorie, "etat_des_lieux_entree_papier")));
  }

  // Aucune écriture : ni ligne papier, ni scan, ni date d'entrée.
  async function attendreRienEcrit(etatDesLieuxId: string) {
    expect(await lignesPapier(etatDesLieuxId)).toEqual([]);
    expect(await scans(etatDesLieuxId)).toEqual([]);
    const [entete] = await db.select().from(etatsDesLieux).where(eq(etatsDesLieux.id, etatDesLieuxId));
    expect(entete?.dateEntree).toBeNull();
    expect(entete?.lieuEntree).toBeNull();
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
        ScisModule,
        BienModule,
        AppartementsModule,
        LocatairesModule,
        BauxModule,
        BailLocatairesModule,
        DocumentsModule,
        EtatsDesLieuxModule,
        EtatsDesLieuxSignatureModule,
        EtatDesLieuxEntreePapierModule
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
    documentsService = moduleRef.get(DocumentsService);
    signatureService = moduleRef.get(EtatsDesLieuxSignatureService);
    entreePapierService = moduleRef.get(EtatDesLieuxEntreePapierService);
    requestContextService = moduleRef.get(RequestContextService);

    ({ organisationId, userId } = await creerOrganisationEtUtilisateur("Organisation Papier Test"));
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
    await rm(storageDirTest, { recursive: true, force: true });
  });

  describe("cas nominal", () => {
    it("déclare l'entrée papier : ligne active, scan réservé, date et lieu d'entrée posés, verrou A sans artefact B", async () => {
      const { etatDesLieuxId, claireId } = await creerDossier();

      const { etatDesLieux, avertissement } = await declarer(etatDesLieuxId, [claireId]);

      expect(avertissement).toBeNull();
      expect(etatDesLieux.dateEntree).toBe("2026-08-01");
      expect(etatDesLieux.lieuEntree).toBe("Lyon");
      expect(etatDesLieux.statut).toBe("entree_terminee");
      expect(etatDesLieux.entreeSigneeParTous).toBe(true);
      expect(etatDesLieux.sortieSigneeParTous).toBe(false);
      expect(etatDesLieux.entreePapier).toEqual({
        dateSignature: "2026-08-01",
        lieu: "Lyon",
        nomsSignataires: ["SCI Papier Test", "Claire Martin"]
      });
      expect(phaseSigneeNumeriquement(phasesDepuisEtatDesLieux(etatDesLieux), "entree")).toBe(false);

      const [ligne, ...autres] = await lignesPapier(etatDesLieuxId);
      expect(autres).toEqual([]);
      expect(ligne?.archivedAt).toBeNull();
      expect(ligne?.declareePar).toBe(userId);
      expect(ligne?.signataires).toEqual([
        { role: "bailleur", locataireId: null, nomAffiche: "SCI Papier Test" },
        { role: "locataire", locataireId: claireId, nomAffiche: "Claire Martin" }
      ]);
      const [scan] = await scans(etatDesLieuxId);
      expect(scan?.id).toBe(ligne?.documentId);
      expect(scan?.etatDesLieuxPhase).toBe("entree");
      expect(scan?.mimeType).toBe("application/pdf");
      const { contenu } = await avecContexte(() => documentsService.telecharger(scan!.id));
      expect(contenu.toString()).toContain("%PDF-1.4");

      // Famille A : les nouvelles photos sont des photos de sortie.
      expect(await resoudrePhaseEtatDesLieuxCourante(db, etatDesLieuxId)).toBe("sortie");
      // Pièces d'entrée figées comme après une signature numérique.
      await expect(
        avecContexte(() => etatsDesLieuxService.submitPieceEntree(etatDesLieuxId, { mur: { etatEntree: "M" } }))
      ).rejects.toThrow(ConflictException);
    });

    it("nettoie le lieu et le nom du bailleur, ignore un locataire coché deux fois", async () => {
      const { etatDesLieuxId, claireId, paulId } = await creerDossier();
      await declarer(etatDesLieuxId, [paulId, claireId, paulId], { lieu: "  Lyon 3e  ", bailleurNom: "  Gérant SCI  " });
      const [ligne] = await lignesPapier(etatDesLieuxId);
      expect(ligne?.lieu).toBe("Lyon 3e");
      expect(ligne?.signataires.map((s) => s.nomAffiche)).toEqual(["Gérant SCI", "Claire Martin", "Paul Durand"]);
    });

    it("renvoie un avertissement non bloquant si la date s'écarte de plus d'un mois du début du bail", async () => {
      const { etatDesLieuxId, claireId } = await creerDossier();
      const { etatDesLieux, avertissement } = await declarer(etatDesLieuxId, [claireId], { dateSignature: "2026-06-15" });
      expect(avertissement).toBe(
        "La date de l'état des lieux d'entrée (15/06/2026) s'écarte de plus d'un mois du début du bail (01/08/2026)."
      );
      expect(etatDesLieux.dateEntree).toBe("2026-06-15");
    });

    it("accepte la date du jour", async () => {
      const { etatDesLieuxId, claireId } = await creerDossier();
      const { etatDesLieux } = await declarer(etatDesLieuxId, [claireId], { dateSignature: dateDuJourParis() });
      expect(etatDesLieux.dateEntree).toBe(dateDuJourParis());
    });
  });

  describe("refus, sans rien écrire", () => {
    it("première déclaration sans scan, scan vide, pas un PDF (contrôle sur le contenu), ou trop lourd", async () => {
      const { etatDesLieuxId, claireId } = await creerDossier();
      const appel = (scan: { nomFichier: string; contenu: Buffer } | undefined) =>
        avecContexte(() => entreePapierService.declarer(etatDesLieuxId, dtoPapier([claireId]), scan));

      await expect(appel(undefined)).rejects.toThrow(MESSAGE_SCAN_OBLIGATOIRE);
      await expect(appel({ nomFichier: "vide.pdf", contenu: Buffer.alloc(0) })).rejects.toThrow(/vide/);
      await expect(
        appel({ nomFichier: "photo.pdf", contenu: Buffer.from(PNG_1X1_BASE64, "base64") })
      ).rejects.toThrow("Le scan doit être un fichier PDF.");
      const tropGros = Buffer.alloc(TAILLE_MAX_SCAN_ENTREE_PAPIER_OCTETS + 1);
      tropGros.write("%PDF-1.4");
      await expect(appel({ nomFichier: "gros.pdf", contenu: tropGros })).rejects.toThrow(/taille maximale de 10 Mo/);
      await attendreRienEcrit(etatDesLieuxId);
    });

    it("date dans le futur ou invalide", async () => {
      const { etatDesLieuxId, claireId } = await creerDossier();
      await expect(declarer(etatDesLieuxId, [claireId], { dateSignature: "2999-01-01" })).rejects.toThrow(/futur/);
      await expect(declarer(etatDesLieuxId, [claireId], { dateSignature: "2026-02-30" })).rejects.toThrow(/invalide/);
      await attendreRienEcrit(etatDesLieuxId);
    });

    it("lieu ou nom du bailleur blancs", async () => {
      const { etatDesLieuxId, claireId } = await creerDossier();
      await expect(declarer(etatDesLieuxId, [claireId], { lieu: "   " })).rejects.toThrow(BadRequestException);
      await expect(declarer(etatDesLieuxId, [claireId], { bailleurNom: "  " })).rejects.toThrow(BadRequestException);
      await attendreRienEcrit(etatDesLieuxId);
    });

    it("aucun locataire coché, ou un locataire qui n'est pas partie active au bail", async () => {
      const { etatDesLieuxId, claireId } = await creerDossier();
      const etranger = await locatairesService.create(userId, { nom: "Autre", prenom: "Bail" });
      await expect(declarer(etatDesLieuxId, [])).rejects.toThrow(/Au moins un locataire/);
      await expect(declarer(etatDesLieuxId, [claireId, etranger.id])).rejects.toThrow(/non partie active/);
      await attendreRienEcrit(etatDesLieuxId);
    });

    it("bail sans aucun locataire actif (même contrôle que la signature numérique)", async () => {
      const { etatDesLieuxId, bailId, claireId, paulId } = await creerDossier();
      await db.execute(
        sql`UPDATE bail_locataires SET archived_at = now() WHERE bail_id = ${bailId} AND locataire_id IN (${claireId}, ${paulId})`
      );
      await expect(declarer(etatDesLieuxId, [claireId])).rejects.toThrow(/Au moins un locataire doit être rattaché/);
      await attendreRienEcrit(etatDesLieuxId);
    });

    it("photos d'entrée non archivées : refus listant les pièces, accepté une fois archivées", async () => {
      const { etatDesLieuxId, claireId } = await creerDossier();
      const photo = (pieceType: "sejour" | "chambre", pieceNumero?: number) =>
        avecContexte(() =>
          documentsService.upload(
            {
              entiteType: "etat_des_lieux",
              entiteId: etatDesLieuxId,
              categorie: "photo",
              etatDesLieuxPieceType: pieceType,
              ...(pieceNumero !== undefined && { etatDesLieuxPieceNumero: pieceNumero })
            },
            { originalname: "p.jpg", mimetype: "image/jpeg", buffer: Buffer.from("x"), size: 1 } as Express.Multer.File
          )
        );
      const p1 = await photo("sejour");
      const p2 = await photo("chambre", 1);
      const p3 = await photo("chambre", 1);

      await expect(declarer(etatDesLieuxId, [claireId])).rejects.toThrow(
        "Entrée papier refusée : 3 photo(s) d'entrée prise(s) dans l'application ne sont pas archivées (Chambre 1, Séjour). Archivez-les avant de déclarer l'entrée papier."
      );
      await attendreRienEcrit(etatDesLieuxId);

      for (const p of [p1, p2, p3]) {
        await avecContexte(() => documentsService.archiver(p.id));
      }
      await expect(declarer(etatDesLieuxId, [claireId])).resolves.toBeTruthy();
    });

    it("entrée déjà signée numériquement", async () => {
      const { etatDesLieuxId, claireId, paulId } = await creerDossier();
      await avecContexte(() => signatureService.signerEntree(etatDesLieuxId, dtoSignature([claireId, paulId])));
      await expect(declarer(etatDesLieuxId, [claireId])).rejects.toThrow(MESSAGE_ENTREE_SIGNEE_NUMERIQUEMENT);
      expect(await lignesPapier(etatDesLieuxId)).toEqual([]);
      expect(await scans(etatDesLieuxId)).toEqual([]);
    });

    it("brouillon abandonné", async () => {
      const { etatDesLieuxId, claireId } = await creerDossier();
      await avecContexte(() => etatsDesLieuxService.abandonner(etatDesLieuxId, { motif: "Erreur" }));
      await expect(declarer(etatDesLieuxId, [claireId])).rejects.toThrow(/abandonné/);
      expect(await lignesPapier(etatDesLieuxId)).toEqual([]);
    });

    it("autre organisation ou contexte absent : introuvable, déclaration comme historique", async () => {
      const { etatDesLieuxId, claireId } = await creerDossier();
      const autre = await creerOrganisationEtUtilisateur("Organisation Étrangère");
      const etranger = { utilisateurId: autre.userId, organisationId: autre.organisationId };
      await expect(
        avecContexte(() => entreePapierService.declarer(etatDesLieuxId, dtoPapier([claireId]), scanPdf()), etranger)
      ).rejects.toThrow(NotFoundException);
      await expect(avecContexte(() => entreePapierService.historique(etatDesLieuxId), etranger)).rejects.toThrow(
        NotFoundException
      );
      await expect(entreePapierService.declarer(etatDesLieuxId, dtoPapier([claireId]), scanPdf())).rejects.toThrow(
        NotFoundException
      );
      await attendreRienEcrit(etatDesLieuxId);
    });
  });

  describe("correction tant que la sortie n'est pas signée", () => {
    it("sans nouveau scan : le document du scan précédent est repris, rien n'est dupliqué", async () => {
      const { etatDesLieuxId, claireId, paulId } = await creerDossier();
      await declarer(etatDesLieuxId, [claireId], {}, scanPdf("unique"));
      const [premiere] = await lignesPapier(etatDesLieuxId);

      const { etatDesLieux } = await avecContexte(() =>
        entreePapierService.declarer(
          etatDesLieuxId,
          dtoPapier([claireId, paulId], { dateSignature: "2026-08-03", lieu: "Bron" }),
          undefined
        )
      );

      expect(etatDesLieux.dateEntree).toBe("2026-08-03");
      expect(etatDesLieux.lieuEntree).toBe("Bron");
      const lignes = await lignesPapier(etatDesLieuxId);
      expect(lignes).toHaveLength(2);
      const active = lignes.find((l) => l.archivedAt === null);
      expect(active?.id).not.toBe(premiere!.id);
      expect(active?.documentId).toBe(premiere!.documentId);
      expect(lignes.find((l) => l.id === premiere!.id)?.archivedAt).toBeInstanceOf(Date);
      // Un seul document de scan, toujours lisible, jamais archivé.
      const tousLesScans = await scans(etatDesLieuxId);
      expect(tousLesScans.map((s) => s.id)).toEqual([premiere!.documentId]);
      expect(tousLesScans[0]?.archivedAt).toBeNull();
      const { contenu } = await avecContexte(() => documentsService.telecharger(premiere!.documentId));
      expect(contenu.toString()).toContain("unique");
    });

    it("une correction sans scan reste soumise aux mêmes refus (sortie signée), sans rien écrire", async () => {
      const { etatDesLieuxId, claireId, paulId } = await creerDossier();
      await declarer(etatDesLieuxId, [claireId]);
      await avecContexte(() => signatureService.signerSortie(etatDesLieuxId, dtoSignature([claireId, paulId], true)));
      await expect(
        avecContexte(() => entreePapierService.declarer(etatDesLieuxId, dtoPapier([claireId]), undefined))
      ).rejects.toThrow(MESSAGE_SORTIE_SIGNEE);
      expect(await lignesPapier(etatDesLieuxId)).toHaveLength(1);
    });

    it("nouvelle ligne, ancienne archivée, ancien scan conservé ; date et lieu suivent la déclaration active ; historique complet", async () => {
      const { etatDesLieuxId, claireId, paulId } = await creerDossier();
      await declarer(etatDesLieuxId, [claireId], {}, scanPdf("premier"));
      const [premiere] = await lignesPapier(etatDesLieuxId);

      const { etatDesLieux } = await declarer(
        etatDesLieuxId,
        [claireId, paulId],
        { dateSignature: "2026-08-02", lieu: "Villeurbanne" },
        scanPdf("second")
      );

      expect(etatDesLieux.dateEntree).toBe("2026-08-02");
      expect(etatDesLieux.lieuEntree).toBe("Villeurbanne");
      expect(etatDesLieux.entreePapier?.nomsSignataires).toEqual(["SCI Papier Test", "Claire Martin", "Paul Durand"]);

      const lignes = await lignesPapier(etatDesLieuxId);
      expect(lignes).toHaveLength(2);
      const archivee = lignes.find((l) => l.id === premiere!.id);
      const active = lignes.find((l) => l.id !== premiere!.id);
      expect(archivee?.archivedAt).toBeInstanceOf(Date);
      expect(archivee?.dateSignature).toBe("2026-08-01");
      expect(archivee?.lieu).toBe("Lyon");
      expect(active?.archivedAt).toBeNull();

      // L'ancien scan reste stocké, non archivé, lisible.
      const tousLesScans = await scans(etatDesLieuxId);
      expect(tousLesScans.map((s) => s.id).sort()).toEqual([premiere!.documentId, active!.documentId].sort());
      expect(tousLesScans.every((s) => s.archivedAt === null)).toBe(true);
      const { contenu } = await avecContexte(() => documentsService.telecharger(premiere!.documentId));
      expect(contenu.toString()).toContain("premier");

      const historique = await avecContexte(() => entreePapierService.historique(etatDesLieuxId));
      expect(historique.map((h) => [h.id, h.archivedAt === null])).toEqual([
        [active!.id, true],
        [premiere!.id, false]
      ]);
    });

    it("sortie signée numériquement après une entrée papier, puis plus aucune correction", async () => {
      const { etatDesLieuxId, claireId, paulId } = await creerDossier();
      await declarer(etatDesLieuxId, [claireId]);

      const apresSortie = await avecContexte(() =>
        signatureService.signerSortie(etatDesLieuxId, dtoSignature([claireId, paulId], true))
      );
      expect(apresSortie.sortieSigneeParTous).toBe(true);
      expect(apresSortie.entreePapier).not.toBeNull();
      expect(apresSortie.statut).toBe("complet");
      const phases = phasesDepuisEtatDesLieux(apresSortie);
      expect(phaseSigneeNumeriquement(phases, "entree")).toBe(false);
      expect(phaseSigneeNumeriquement(phases, "sortie")).toBe(true);
      // Date et lieu d'entrée gardés, ceux de sortie posés par la signature.
      expect(apresSortie.dateEntree).toBe("2026-08-01");
      expect(apresSortie.lieuEntree).toBe("Lyon");
      expect(apresSortie.dateSortie).toBe(dateDuJourParis());

      await expect(declarer(etatDesLieuxId, [claireId], { lieu: "Correction" })).rejects.toThrow(MESSAGE_SORTIE_SIGNEE);
      expect(await lignesPapier(etatDesLieuxId)).toHaveLength(1);
      expect(await scans(etatDesLieuxId)).toHaveLength(1);
    });
  });

  describe("exclusion mutuelle avec la signature numérique d'entrée", () => {
    it("signerEntree refuse une entrée papier, sans rien écrire", async () => {
      const { etatDesLieuxId, claireId, paulId } = await creerDossier();
      await declarer(etatDesLieuxId, [claireId]);
      await expect(
        avecContexte(() => signatureService.signerEntree(etatDesLieuxId, dtoSignature([claireId, paulId])))
      ).rejects.toThrow(MESSAGE_ENTREE_DECLAREE_PAPIER);
      expect(
        await db.select().from(etatDesLieuxSignature).where(eq(etatDesLieuxSignature.etatDesLieuxId, etatDesLieuxId))
      ).toEqual([]);
    });

    // L'ordre inverse (signature puis déclaration) est couvert dans les
    // refus ci-dessus. Le VRAI parallèle (deux connexions, attente du
    // verrou) ne se teste pas sur la connexion unique de ce fichier : voir
    // entree-papier-concurrence.integration.spec.ts.
  });

  describe("catégorie du scan réservée", () => {
    it("ni upload générique, ni reclassement, ni archivage du scan", async () => {
      const { etatDesLieuxId, claireId } = await creerDossier();
      await expect(
        avecContexte(() =>
          documentsService.upload(
            { entiteType: "etat_des_lieux", entiteId: etatDesLieuxId, categorie: "etat_des_lieux_entree_papier" },
            { originalname: "s.pdf", mimetype: "application/pdf", buffer: scanPdf().contenu, size: 20 } as Express.Multer.File
          )
        )
      ).rejects.toThrow(BadRequestException);

      await declarer(etatDesLieuxId, [claireId]);
      const [scan] = await scans(etatDesLieuxId);
      await expect(avecContexte(() => documentsService.archiver(scan!.id))).rejects.toThrow(ConflictException);
      await expect(
        avecContexte(() => documentsService.update(scan!.id, { categorie: "courrier" }))
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("garanties portées par la base", () => {
    // Chaque écriture refusée passe dans un point de sauvegarde (transaction
    // imbriquée) : une erreur Postgres annulerait sinon toute la transaction
    // du test.
    function dansUnSavepoint(ecriture: (tx: Database) => Promise<unknown>): Promise<unknown> {
      return db.transaction((tx) => ecriture(tx as unknown as Database));
    }

    async function declarationEnBase() {
      const dossier = await creerDossier();
      await declarer(dossier.etatDesLieuxId, [dossier.claireId]);
      const [ligne] = await lignesPapier(dossier.etatDesLieuxId);
      return { ...dossier, ligne: ligne! };
    }

    it("DELETE et TRUNCATE refusés", async () => {
      const { ligne } = await declarationEnBase();
      await expect(
        dansUnSavepoint((tx) => tx.delete(etatDesLieuxEntreePapier).where(eq(etatDesLieuxEntreePapier.id, ligne.id)))
      ).rejects.toThrow(/Suppression interdite/);
      await expect(dansUnSavepoint((tx) => tx.execute(sql`TRUNCATE etat_des_lieux_entree_papier`))).rejects.toThrow(
        /Suppression interdite/
      );
      expect(await lignesPapier(ligne.etatDesLieuxId)).toHaveLength(1);
    });

    it("une ligne ne change jamais, sauf pour être archivée une seule fois", async () => {
      const { ligne } = await declarationEnBase();
      const interdit = /ne peut qu'être archivée/;
      for (const valeurs of [{ lieu: "Ailleurs" }, { dateSignature: "2026-07-01" }, { archivedAt: null }]) {
        await expect(
          dansUnSavepoint((tx) =>
            tx.update(etatDesLieuxEntreePapier).set(valeurs).where(eq(etatDesLieuxEntreePapier.id, ligne.id))
          )
        ).rejects.toThrow(interdit);
      }
      await expect(
        dansUnSavepoint((tx) =>
          tx
            .update(etatDesLieuxEntreePapier)
            .set({ archivedAt: new Date(), lieu: "Ailleurs" })
            .where(eq(etatDesLieuxEntreePapier.id, ligne.id))
        )
      ).rejects.toThrow(interdit);

      await db
        .update(etatDesLieuxEntreePapier)
        .set({ archivedAt: new Date() })
        .where(eq(etatDesLieuxEntreePapier.id, ligne.id));
      await expect(
        dansUnSavepoint((tx) =>
          tx
            .update(etatDesLieuxEntreePapier)
            .set({ archivedAt: new Date() })
            .where(eq(etatDesLieuxEntreePapier.id, ligne.id))
        )
      ).rejects.toThrow(interdit);
    });

    it("une seule déclaration active par état des lieux", async () => {
      const { ligne } = await declarationEnBase();
      const [autreScan] = await db
        .insert(documents)
        .values({
          entiteType: "etat_des_lieux",
          entiteId: ligne.etatDesLieuxId,
          categorie: "etat_des_lieux_entree_papier",
          nomFichier: "b.pdf",
          mimeType: "application/pdf",
          tailleOctets: 1,
          cheminStockage: "test/b.pdf",
          etatDesLieuxPhase: "entree"
        })
        .returning();
      await expect(
        dansUnSavepoint((tx) =>
          tx.insert(etatDesLieuxEntreePapier).values({
            etatDesLieuxId: ligne.etatDesLieuxId,
            dateSignature: "2026-08-01",
            lieu: "Lyon",
            documentId: autreScan!.id,
            signataires: ligne.signataires,
            declareeLe: new Date(),
            declareePar: userId
          })
        )
      ).rejects.toThrow(/etat_des_lieux_entree_papier_active_unique|duplicate key/);
    });

    it("signature numérique d'entrée refusée par la base quand une déclaration est active", async () => {
      const { ligne } = await declarationEnBase();
      await expect(
        dansUnSavepoint((tx) =>
          tx.insert(etatDesLieuxSignature).values({
            etatDesLieuxId: ligne.etatDesLieuxId,
            phase: "entree",
            role: "bailleur",
            nomAffiche: "Bailleur",
            documentId: ligne.documentId,
            luEtApprouve: true,
            signeLe: new Date()
          })
        )
      ).rejects.toThrow(/établie sur papier/);
    });

    it("déclaration refusée par la base après une signature numérique d'entrée ou une signature de sortie", async () => {
      const { etatDesLieuxId, claireId, paulId } = await creerDossier();
      const insererDeclaration = (tx: Database, documentId: string) =>
        tx.insert(etatDesLieuxEntreePapier).values({
          etatDesLieuxId,
          dateSignature: "2026-08-01",
          lieu: "Lyon",
          documentId,
          signataires: [
            { role: "bailleur", locataireId: null, nomAffiche: "B" },
            { role: "locataire", locataireId: claireId, nomAffiche: "C" }
          ],
          declareeLe: new Date(),
          declareePar: userId
        });
      await avecContexte(() => signatureService.signerEntree(etatDesLieuxId, dtoSignature([claireId, paulId])));
      const [signature] = await db
        .select()
        .from(etatDesLieuxSignature)
        .where(eq(etatDesLieuxSignature.etatDesLieuxId, etatDesLieuxId));
      await expect(dansUnSavepoint((tx) => insererDeclaration(tx, signature!.documentId))).rejects.toThrow(
        /signée numériquement/
      );

      // Sortie signée : la base refuse aussi (la signature d'entrée est
      // archivée ici à la main pour isoler la règle de sortie).
      await avecContexte(() =>
        signatureService.signerSortie(etatDesLieuxId, dtoSignature([claireId, paulId], true))
      );
      await db
        .update(etatDesLieuxSignature)
        .set({ archivedAt: new Date() })
        .where(and(eq(etatDesLieuxSignature.etatDesLieuxId, etatDesLieuxId), eq(etatDesLieuxSignature.phase, "entree")));
      await expect(dansUnSavepoint((tx) => insererDeclaration(tx, signature!.documentId))).rejects.toThrow(
        /sortie de cet état des lieux est signée/
      );
    });
  });
});
