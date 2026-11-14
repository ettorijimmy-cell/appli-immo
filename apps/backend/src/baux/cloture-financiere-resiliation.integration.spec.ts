import { randomUUID } from "crypto";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { validate } from "class-validator";
import { baux, createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, paiements, utilisateurs, type Database } from "db";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AlertesJobService } from "../alertes/alertes-job.service";
import { AlertesModule } from "../alertes/alertes.module";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { BailLocatairesModule } from "../bail-locataires/bail-locataires.module";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CandidatsModule } from "../candidats/candidats.module";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { GarantsModule } from "../garants/garants.module";
import { LocatairesModule } from "../locataires/locataires.module";
import { PaiementsModule } from "../paiements/paiements.module";
import { PaiementsService } from "../paiements/paiements.service";
import { RemboursementsModule } from "../remboursements/remboursements.module";
import { RemboursementsService } from "../remboursements/remboursements.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { TableauDeBordModule } from "../tableau-de-bord/tableau-de-bord.module";
import { TableauDeBordService } from "../tableau-de-bord/tableau-de-bord.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { VersementsModule } from "../versements/versements.module";
import { VersementsService } from "../versements/versements.service";
import { BauxModule } from "./baux.module";
import { BauxService } from "./baux.service";
import { MESSAGE_DATE_FIN_RESILIATION_OBLIGATOIRE, ResilierBailDto } from "./dto/resilier-bail.dto";

// Clôture financière à la résiliation (chantier financier de la
// résiliation, conception 1, décisions 4 à 8 du 2026-11-14). Bail de
// l'audit : 550 € charges comprises (500 + 50), échéance le 5, entré le
// 01/01/2026 ; échéances des mois suivants produites par le vrai job
// (AlertesJobService.genererEcheancesRecurrentes), versements par le vrai
// VersementsService (statut recalculé comme en usage réel).
describe("Clôture financière à la résiliation (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let bauxService: BauxService;
  let paiementsService: PaiementsService;
  let versementsService: VersementsService;
  let remboursementsService: RemboursementsService;
  let tableauDeBordService: TableauDeBordService;
  let alertesJobService: AlertesJobService;
  let requestContextService: RequestContextService;
  let db: Database;
  let userId: string;
  let organisationId: string;
  let autreOrganisationId: string;
  let appartementId: string;

  const dansMonOrganisation = <T>(fn: () => Promise<T>): Promise<T> =>
    requestContextService.executerAvecContexte({ utilisateurId: userId, organisationId }, fn);
  const dansUneAutreOrganisation = <T>(fn: () => Promise<T>): Promise<T> =>
    requestContextService.executerAvecContexte({ utilisateurId: userId, organisationId: autreOrganisationId }, fn);

  // Bail actif entré le `dateDebut`, avec les échéances récurrentes des
  // mois listés (AAAA-MM), générées par le job.
  async function bailAvecEcheances(moisGeneres: string[], dateDebut = "2026-01-01") {
    const bail = await dansMonOrganisation(() =>
      bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut,
        loyerMensuel: "500.00",
        provisionsCharges: "50.00",
        jourEcheance: 5
      })
    );
    await dansMonOrganisation(() => bauxService.activer(bail.id));
    for (const mois of moisGeneres) {
      await alertesJobService.genererEcheancesRecurrentes(`${mois}-10`);
    }
    return bail.id;
  }

  async function echeancesLoyer(bailId: string) {
    return db
      .select()
      .from(paiements)
      .where(and(eq(paiements.bailId, bailId), eq(paiements.type, "loyer")))
      .orderBy(asc(paiements.dateEcheance));
  }

  async function echeanceDuMois(bailId: string, mois: string) {
    const echeance = (await echeancesLoyer(bailId)).find((e) => e.dateEcheance.startsWith(mois));
    if (!echeance) {
      throw new Error(`Échéance de ${mois} introuvable`);
    }
    return echeance;
  }

  async function verser(paiementId: string, montant: string, dateVersement: string) {
    return dansMonOrganisation(() => versementsService.ajouter({ paiementId, montant, mode: "virement", dateVersement }));
  }

  const resilier = (bailId: string, dateFin: string) => dansMonOrganisation(() => bauxService.resilier(bailId, { dateFin }));

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
        BauxModule,
        PaiementsModule,
        VersementsModule,
        RemboursementsModule,
        LocatairesModule,
        GarantsModule,
        BailLocatairesModule,
        CandidatsModule,
        TableauDeBordModule,
        AlertesModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    const scisService = moduleRef.get(ScisService);
    const bienService = moduleRef.get(BienService);
    const appartementsService = moduleRef.get(AppartementsService);
    bauxService = moduleRef.get(BauxService);
    paiementsService = moduleRef.get(PaiementsService);
    versementsService = moduleRef.get(VersementsService);
    remboursementsService = moduleRef.get(RemboursementsService);
    tableauDeBordService = moduleRef.get(TableauDeBordService);
    alertesJobService = moduleRef.get(AlertesJobService);
    requestContextService = moduleRef.get(RequestContextService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Clôture Résiliation" })
      .returning();
    const [autreOrganisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Autre Organisation Clôture Résiliation" })
      .returning();
    if (!organisation || !autreOrganisation) {
      throw new Error("Échec de l'insertion des organisations de test");
    }
    organisationId = organisation.id;
    autreOrganisationId = autreOrganisation.id;

    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId,
        email: `cloture-resiliation-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Clôture",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    userId = user.id;

    const sci = await scisService.create(userId, {
      nom: "SCI Clôture Résiliation",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Clôture Résiliation",
      adresse: "1 rue de la Clôture",
      codePostal: "75001",
      ville: "Paris",
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
      loyerReference: "500.00"
    });
    appartementId = appartement.id;
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  describe("mois de fin (Cas A) — fin le 15/03/2026", () => {
    it("impayé : montant ET décomposition au prorata (266,12 = 241,93 + 24,19), statut impayé, mois précédents intacts", async () => {
      const bailId = await bailAvecEcheances(["2026-02", "2026-03"]);

      const resultat = await resilier(bailId, "2026-03-15");

      const mars = await echeanceDuMois(bailId, "2026-03");
      expect(mars).toMatchObject({ montant: "266.12", loyerHorsCharges: "241.93", charges: "24.19", statut: "impaye" });
      const fevrier = await echeanceDuMois(bailId, "2026-02");
      expect(fevrier).toMatchObject({ montant: "550.00", loyerHorsCharges: "500.00", charges: "50.00", archivedAt: null });
      const janvier = await echeanceDuMois(bailId, "2026-01");
      expect(janvier).toMatchObject({ montant: "550.00", archivedAt: null });
      expect(resultat).toMatchObject({
        statut: "resilie",
        dateFin: "2026-03-15",
        tropPercu: null,
        echeancesArchivees: 0,
        echeancesConservees: [],
        tropPercuTotal: "0.00",
        resteARembourserTotal: "0.00"
      });
    });

    it("partiel (100 € reçus) : reste partiel au prorata, aucun trop-perçu", async () => {
      const bailId = await bailAvecEcheances(["2026-02", "2026-03"]);
      await verser((await echeanceDuMois(bailId, "2026-03")).id, "100.00", "2026-03-05");

      const resultat = await resilier(bailId, "2026-03-15");

      expect(await echeanceDuMois(bailId, "2026-03")).toMatchObject({ montant: "266.12", statut: "partiel" });
      expect(resultat.tropPercu).toBeNull();
      expect(resultat.tropPercuTotal).toBe("0.00");
    });

    it("partiel (300 € reçus, plus que le prorata) : passe payé, trop-perçu 33,88", async () => {
      const bailId = await bailAvecEcheances(["2026-02", "2026-03"]);
      const mars = await echeanceDuMois(bailId, "2026-03");
      await verser(mars.id, "300.00", "2026-03-05");

      const resultat = await resilier(bailId, "2026-03-15");

      expect(await echeanceDuMois(bailId, "2026-03")).toMatchObject({
        montant: "266.12",
        loyerHorsCharges: "241.93",
        charges: "24.19",
        statut: "paye"
      });
      expect(resultat.tropPercu).toEqual({ paiementId: mars.id, montant: "33.88" });
      expect(resultat.tropPercuTotal).toBe("33.88");
    });

    it("payé 550 € : inchangé, trop-perçu 283,88", async () => {
      const bailId = await bailAvecEcheances(["2026-02", "2026-03"]);
      const mars = await echeanceDuMois(bailId, "2026-03");
      await verser(mars.id, "550.00", "2026-03-05");

      const resultat = await resilier(bailId, "2026-03-15");

      expect(await echeanceDuMois(bailId, "2026-03")).toMatchObject({
        montant: "550.00",
        loyerHorsCharges: "500.00",
        charges: "50.00",
        statut: "paye"
      });
      expect(resultat.tropPercu).toEqual({ paiementId: mars.id, montant: "283.88" });
      expect(resultat.tropPercuTotal).toBe("283.88");
    });
  });

  describe("bornes du prorata", () => {
    it("fin le 1er : un jour (17,74 = 16,13 + 1,61)", async () => {
      const bailId = await bailAvecEcheances(["2026-02", "2026-03"]);
      await resilier(bailId, "2026-03-01");
      expect(await echeanceDuMois(bailId, "2026-03")).toMatchObject({
        montant: "17.74",
        loyerHorsCharges: "16.13",
        charges: "1.61"
      });
    });

    it("fin le dernier jour : mois plein, et le mois suivant est archivé", async () => {
      const bailId = await bailAvecEcheances(["2026-02", "2026-03", "2026-04"]);
      const resultat = await resilier(bailId, "2026-03-31");
      expect(await echeanceDuMois(bailId, "2026-03")).toMatchObject({
        montant: "550.00",
        loyerHorsCharges: "500.00",
        charges: "50.00"
      });
      expect((await echeanceDuMois(bailId, "2026-04")).archivedAt).not.toBeNull();
      expect(resultat.echeancesArchivees).toBe(1);
    });

    it("même mois que la date de début : de date_debut à date_fin (10 → 20/03 : 195,16 = 177,42 + 17,74)", async () => {
      const bailId = await bailAvecEcheances([], "2026-03-10");
      await resilier(bailId, "2026-03-20");
      expect(await echeanceDuMois(bailId, "2026-03")).toMatchObject({
        montant: "195.16",
        loyerHorsCharges: "177.42",
        charges: "17.74",
        statut: "impaye"
      });
    });
  });

  describe("mois de fin sans échéance (Cas B)", () => {
    it("échéance du mois de fin archivée auparavant : le mois est dû, une échéance au prorata est recréée", async () => {
      const bailId = await bailAvecEcheances(["2026-02", "2026-03"]);
      const marsArchivee = await echeanceDuMois(bailId, "2026-03");
      await dansMonOrganisation(() => paiementsService.archive(marsArchivee.id));

      await resilier(bailId, "2026-03-15");

      const mars = (await echeancesLoyer(bailId)).filter((e) => e.dateEcheance.startsWith("2026-03"));
      expect(mars).toHaveLength(2);
      expect(mars.find((e) => e.id === marsArchivee.id)?.archivedAt).not.toBeNull();
      expect(mars.find((e) => e.id !== marsArchivee.id)).toMatchObject({
        montant: "266.12",
        loyerHorsCharges: "241.93",
        charges: "24.19",
        dateEcheance: "2026-03-15",
        archivedAt: null
      });
    });

    it("crée l'échéance au prorata, décomposition renseignée, datée de la date de fin", async () => {
      const bailId = await bailAvecEcheances(["2026-02"]);
      const resultat = await resilier(bailId, "2026-03-15");
      expect(await echeanceDuMois(bailId, "2026-03")).toMatchObject({
        montant: "266.12",
        loyerHorsCharges: "241.93",
        charges: "24.19",
        dateEcheance: "2026-03-15",
        statut: "impaye"
      });
      expect(resultat.tropPercu).toBeNull();
    });
  });

  describe("échéances d'un mois après la fin — fin le 15/03/2026", () => {
    it("avril impayé : archivée (avec l'audit habituel), plus d'alerte possible", async () => {
      const bailId = await bailAvecEcheances(["2026-02", "2026-03", "2026-04"]);
      const avant = await echeanceDuMois(bailId, "2026-04");

      const resultat = await resilier(bailId, "2026-03-15");

      const avril = await echeanceDuMois(bailId, "2026-04");
      expect(avril.archivedAt).not.toBeNull();
      expect(avril.updatedBy).toBe(userId);
      expect(avril.version).toBe(avant.version + 1);
      expect(avril.montant).toBe("550.00");
      expect(resultat.echeancesArchivees).toBe(1);
      expect(resultat.echeancesConservees).toEqual([]);
    });

    it("avril partiel (200 €) : conservée, trop-perçu 200,00", async () => {
      const bailId = await bailAvecEcheances(["2026-02", "2026-03", "2026-04"]);
      const avril = await echeanceDuMois(bailId, "2026-04");
      await verser(avril.id, "200.00", "2026-04-05");

      const resultat = await resilier(bailId, "2026-03-15");

      expect(await echeanceDuMois(bailId, "2026-04")).toMatchObject({ archivedAt: null, montant: "550.00", statut: "partiel" });
      expect(resultat.echeancesArchivees).toBe(0);
      expect(resultat.echeancesConservees).toEqual([
        { paiementId: avril.id, dateEcheance: "2026-04-05", montant: "550.00", tropPercu: "200.00", resteARembourser: "200.00" }
      ]);
      expect(resultat.tropPercuTotal).toBe("200.00");
      expect(resultat.resteARembourserTotal).toBe("200.00");
    });

    it("mars payé 550 + avril payé 550 : trop-perçu total 833,88 (283,88 + 550,00)", async () => {
      const bailId = await bailAvecEcheances(["2026-02", "2026-03", "2026-04"]);
      await verser((await echeanceDuMois(bailId, "2026-03")).id, "550.00", "2026-03-05");
      await verser((await echeanceDuMois(bailId, "2026-04")).id, "550.00", "2026-04-05");

      const resultat = await resilier(bailId, "2026-03-15");

      expect(resultat.tropPercu?.montant).toBe("283.88");
      expect(resultat.echeancesConservees.map((e) => e.tropPercu)).toEqual(["550.00"]);
      expect(resultat.tropPercuTotal).toBe("833.88");
      expect(resultat.resteARembourserTotal).toBe("833.88");
    });

    it("remboursement déjà saisi sur avril avant la résiliation : reste à rembourser 283,88 (mois de fin seul), brut 833,88", async () => {
      const bailId = await bailAvecEcheances(["2026-02", "2026-03", "2026-04"]);
      const avril = await echeanceDuMois(bailId, "2026-04");
      await verser((await echeanceDuMois(bailId, "2026-03")).id, "550.00", "2026-03-05");
      await verser(avril.id, "550.00", "2026-04-05");
      await dansMonOrganisation(() =>
        remboursementsService.create({
          bailId,
          paiementId: avril.id,
          type: "trop_percu",
          montantOrigine: "550.00",
          montantRembourse: "550.00",
          dateRemboursement: "2026-04-20",
          mode: "virement"
        })
      );

      const resultat = await resilier(bailId, "2026-03-15");

      expect((await echeanceDuMois(bailId, "2026-04")).archivedAt).toBeNull();
      expect(resultat.echeancesConservees).toEqual([
        { paiementId: avril.id, dateEcheance: "2026-04-05", montant: "550.00", tropPercu: "550.00", resteARembourser: "0.00" }
      ]);
      expect(resultat.tropPercuTotal).toBe("833.88");
      expect(resultat.resteARembourserTotal).toBe("283.88");
    });

    it("versement d'avril annulé (archivé) : comme aucun versement, archivée", async () => {
      const bailId = await bailAvecEcheances(["2026-02", "2026-03", "2026-04"]);
      const avril = await echeanceDuMois(bailId, "2026-04");
      const versement = await verser(avril.id, "550.00", "2026-04-05");
      await dansMonOrganisation(() => versementsService.annuler(versement.id));

      const resultat = await resilier(bailId, "2026-03-15");

      expect((await echeanceDuMois(bailId, "2026-04")).archivedAt).not.toBeNull();
      expect(resultat.echeancesArchivees).toBe(1);
      expect(resultat.tropPercuTotal).toBe("0.00");
    });

    it("échéance déjà archivée avant la résiliation : ignorée, rien n'est réécrit", async () => {
      const bailId = await bailAvecEcheances(["2026-02", "2026-03", "2026-04"]);
      const avril = await echeanceDuMois(bailId, "2026-04");
      await dansMonOrganisation(() => paiementsService.archive(avril.id));
      const archiveeAvant = await echeanceDuMois(bailId, "2026-04");

      const resultat = await resilier(bailId, "2026-03-15");

      const archiveeApres = await echeanceDuMois(bailId, "2026-04");
      expect(archiveeApres.version).toBe(archiveeAvant.version);
      expect(archiveeApres.archivedAt).toEqual(archiveeAvant.archivedAt);
      expect(resultat.echeancesArchivees).toBe(0);
    });

    it("plusieurs mois après la fin : avril payé gardé, mai et juin impayés archivés", async () => {
      const bailId = await bailAvecEcheances(["2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]);
      const avril = await echeanceDuMois(bailId, "2026-04");
      await verser(avril.id, "550.00", "2026-04-05");

      const resultat = await resilier(bailId, "2026-03-15");

      expect(resultat.echeancesArchivees).toBe(2);
      expect(resultat.echeancesConservees.map((e) => e.paiementId)).toEqual([avril.id]);
      expect((await echeanceDuMois(bailId, "2026-05")).archivedAt).not.toBeNull();
      expect((await echeanceDuMois(bailId, "2026-06")).archivedAt).not.toBeNull();
      expect((await echeanceDuMois(bailId, "2026-04")).archivedAt).toBeNull();
    });

    it("le job ne génère plus rien pour un bail résilié", async () => {
      const bailId = await bailAvecEcheances(["2026-02", "2026-03"]);
      await resilier(bailId, "2026-03-15");
      const avant = (await echeancesLoyer(bailId)).length;

      await alertesJobService.genererEcheancesRecurrentes("2026-04-10");

      expect((await echeancesLoyer(bailId)).length).toBe(avant);
    });
  });

  describe("refus, avant toute écriture", () => {
    it("deux échéances non archivées dans le mois de fin : 409 explicite, rien n'est modifié", async () => {
      const bailId = await bailAvecEcheances(["2026-02", "2026-03"]);
      await db
        .insert(paiements)
        .values({ bailId, type: "loyer", montant: "550.00", dateEcheance: "2026-03-20", loyerHorsCharges: "500.00", charges: "50.00" });
      const avant = await echeancesLoyer(bailId);

      await expect(resilier(bailId, "2026-03-15")).rejects.toThrow(ConflictException);
      await expect(resilier(bailId, "2026-03-15")).rejects.toThrow(/Plusieurs échéances de loyer \(2\)/);

      const [bail] = await db.select().from(baux).where(eq(baux.id, bailId));
      expect(bail?.statut).toBe("actif");
      expect(bail?.dateFin).toBeNull();
      expect(await echeancesLoyer(bailId)).toEqual(avant);
    });

    it("date absente : 400 (service), le bail reste actif", async () => {
      const bailId = await bailAvecEcheances(["2026-02"]);
      await expect(
        dansMonOrganisation(() => bauxService.resilier(bailId, {} as unknown as ResilierBailDto))
      ).rejects.toThrow(BadRequestException);
      const [bail] = await db.select().from(baux).where(eq(baux.id, bailId));
      expect(bail?.statut).toBe("actif");
    });

    it("date absente ou mal formée : refusée par le DTO (400 HTTP) avec un message en français", async () => {
      const sansDate = await validate(Object.assign(new ResilierBailDto(), {}));
      expect(sansDate.flatMap((e) => Object.values(e.constraints ?? {}))).toContain(
        MESSAGE_DATE_FIN_RESILIATION_OBLIGATOIRE
      );
      const horodatage = await validate(Object.assign(new ResilierBailDto(), { dateFin: "2026-03-15T00:00:00Z" }));
      expect(horodatage).toHaveLength(1);
      const correcte = await validate(Object.assign(new ResilierBailDto(), { dateFin: "2026-03-15" }));
      expect(correcte).toEqual([]);
    });

    it("date inexistante (31/02) : 400 (service)", async () => {
      const bailId = await bailAvecEcheances(["2026-02"]);
      await expect(resilier(bailId, "2026-02-31")).rejects.toThrow(BadRequestException);
    });

    it("autre organisation : 404 avant tout (date absente, deux échéances le mois de fin)", async () => {
      const bailId = await bailAvecEcheances(["2026-02", "2026-03"]);
      await db
        .insert(paiements)
        .values({ bailId, type: "loyer", montant: "550.00", dateEcheance: "2026-03-20" });

      await expect(
        dansUneAutreOrganisation(() => bauxService.resilier(bailId, {} as unknown as ResilierBailDto))
      ).rejects.toThrow(NotFoundException);
      await expect(
        dansUneAutreOrganisation(() => bauxService.resilier(bailId, { dateFin: "2026-03-15" }))
      ).rejects.toThrow(NotFoundException);
      const [bail] = await db.select().from(baux).where(eq(baux.id, bailId));
      expect(bail?.statut).toBe("actif");
    });
  });

  describe("remboursements en attente (tableau de bord)", () => {
    it("mois de fin ET mois après la fin, chacun réduit de SES remboursements, sans double compte", async () => {
      const bailId = await bailAvecEcheances(["2026-02", "2026-03", "2026-04"]);
      const mars = await echeanceDuMois(bailId, "2026-03");
      const avril = await echeanceDuMois(bailId, "2026-04");
      await verser(mars.id, "550.00", "2026-03-05");
      await verser(avril.id, "550.00", "2026-04-05");
      await resilier(bailId, "2026-03-15");

      const lignes = async () =>
        (await dansMonOrganisation(() => tableauDeBordService.getRemboursementsEnAttente()))
          .filter((r) => r.bailId === bailId)
          .map((r) => ({ paiementId: r.paiementId, montant: r.montant }));

      expect(await lignes()).toEqual([
        { paiementId: mars.id, montant: "283.88" },
        { paiementId: avril.id, montant: "550.00" }
      ]);

      // 200 € remboursés sur avril : seul avril baisse, mars est inchangé.
      await dansMonOrganisation(() =>
        remboursementsService.create({
          bailId,
          paiementId: avril.id,
          type: "trop_percu",
          montantOrigine: "550.00",
          montantRembourse: "200.00",
          dateRemboursement: "2026-04-20",
          mode: "virement"
        })
      );
      expect(await lignes()).toEqual([
        { paiementId: mars.id, montant: "283.88" },
        { paiementId: avril.id, montant: "350.00" }
      ]);

      // Avril entièrement remboursé : la ligne disparaît, mars reste.
      await dansMonOrganisation(() =>
        remboursementsService.create({
          bailId,
          paiementId: avril.id,
          type: "trop_percu",
          montantOrigine: "550.00",
          montantRembourse: "350.00",
          dateRemboursement: "2026-04-21",
          mode: "virement"
        })
      );
      expect(await lignes()).toEqual([{ paiementId: mars.id, montant: "283.88" }]);
    });

    it("bail archivé après sa résiliation : le trop-perçu après la fin reste en attente", async () => {
      const bailId = await bailAvecEcheances(["2026-02", "2026-03", "2026-04"]);
      const avril = await echeanceDuMois(bailId, "2026-04");
      await verser(avril.id, "550.00", "2026-04-05");
      await resilier(bailId, "2026-03-15");
      await dansMonOrganisation(() => bauxService.archive(bailId));

      const lignes = (await dansMonOrganisation(() => tableauDeBordService.getRemboursementsEnAttente())).filter(
        (r) => r.bailId === bailId
      );
      expect(lignes).toEqual([{ bailId, paiementId: avril.id, montant: "550.00" }]);
    });

    it("bail actif avec une date de fin : les mois après la fin ne sont pas des trop-perçus", async () => {
      const bailId = await bailAvecEcheances(["2026-02", "2026-03", "2026-04"]);
      await db.update(baux).set({ dateFin: "2026-03-15" }).where(eq(baux.id, bailId));
      await verser((await echeanceDuMois(bailId, "2026-04")).id, "550.00", "2026-04-05");

      const lignes = (await dansMonOrganisation(() => tableauDeBordService.getRemboursementsEnAttente())).filter(
        (r) => r.bailId === bailId
      );
      expect(lignes).toEqual([]);
    });
  });
});
