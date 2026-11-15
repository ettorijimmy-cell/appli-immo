import { randomUUID } from "crypto";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  bailPreavis,
  baux,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  journalAudit,
  organisations,
  paiements,
  utilisateurs,
  type Database
} from "db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import type { DeclarerPreavisDto } from "./dto/declarer-preavis.dto";
import { PreavisService } from "./preavis.service";

// Préavis d'un bail (résiliation, conception 2 « vrai préavis », commit 3a,
// décisions de Jimmy du 2026-11-15). Bail de l'audit : 550 € = 500 + 50,
// échéance le 5, entré le 01/10/2026 ; échéances des mois précédents
// produites par le vrai job, versements par le vrai VersementsService.
// La date du jour (Paris) est figée par test : seul `Date` est simulé
// (vi.useFakeTimers({ toFake: ["Date"] })), les minuteries restent réelles.
describe("Préavis : déclarer, corriger, annuler (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let bauxService: BauxService;
  let preavisService: PreavisService;
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

  function aujourdHui(date: string) {
    vi.setSystemTime(new Date(`${date}T10:00:00Z`));
  }

  const congeLocataire = (dateFin: string, surcharges: Partial<DeclarerPreavisDto> = {}): DeclarerPreavisDto => ({
    auteur: "locataire",
    dateReception: "2027-01-15",
    modeRemise: "lrar",
    dureeMois: 3,
    motifReduit: null,
    dateFin,
    ...surcharges
  });

  async function bailAvecEcheances(moisGeneres: string[], typeBail: "vide" | "meuble" = "vide") {
    const bail = await dansMonOrganisation(() =>
      bauxService.create({
        appartementId,
        typeBail,
        dateDebut: "2026-10-01",
        loyerMensuel: "500.00",
        provisionsCharges: "50.00",
        jourEcheance: 5
      })
    );
    await dansMonOrganisation(() => bauxService.activer(bail.id));
    for (const mois of moisGeneres) {
      await alertesJobService.genererEcheancesRecurrentes(`${mois}-01`);
    }
    return bail.id;
  }

  async function echeancesLoyer(bailId: string) {
    return db
      .select()
      .from(paiements)
      .where(and(eq(paiements.bailId, bailId), eq(paiements.type, "loyer")))
      .orderBy(asc(paiements.dateEcheance), asc(paiements.createdAt));
  }

  async function echeanceDuMois(bailId: string, mois: string) {
    const liste = (await echeancesLoyer(bailId)).filter((e) => e.dateEcheance.startsWith(mois) && e.archivedAt === null);
    if (liste.length !== 1) {
      throw new Error(`Attendu une échéance non archivée en ${mois}, trouvé ${liste.length}`);
    }
    return liste[0]!;
  }

  async function verser(paiementId: string, montant: string, dateVersement: string) {
    return dansMonOrganisation(() => versementsService.ajouter({ paiementId, montant, mode: "virement", dateVersement }));
  }

  async function lireBail(bailId: string) {
    const [bail] = await db.select().from(baux).where(eq(baux.id, bailId));
    return bail!;
  }

  // Cohérence statut ⇔ ligne active (décision 7) : une ligne active si et
  // seulement si le bail est en préavis, et baux.date_fin = sa date de fin.
  async function verifierCoherence(bailId: string) {
    const bail = await lireBail(bailId);
    const actives = await db
      .select()
      .from(bailPreavis)
      .where(and(eq(bailPreavis.bailId, bailId), isNull(bailPreavis.archivedAt)));
    if (bail.statut === "preavis") {
      expect(actives).toHaveLength(1);
      expect(bail.dateFin).toBe(actives[0]!.dateFin);
    } else {
      expect(actives).toHaveLength(0);
    }
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    aujourdHui("2027-03-20");
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
    preavisService = moduleRef.get(PreavisService);
    versementsService = moduleRef.get(VersementsService);
    remboursementsService = moduleRef.get(RemboursementsService);
    tableauDeBordService = moduleRef.get(TableauDeBordService);
    alertesJobService = moduleRef.get(AlertesJobService);
    requestContextService = moduleRef.get(RequestContextService);

    const [organisation] = await db.insert(organisations).values({ type: "particulier", nom: "Organisation Préavis" }).returning();
    const [autreOrganisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Autre Organisation Préavis" })
      .returning();
    organisationId = organisation!.id;
    autreOrganisationId = autreOrganisation!.id;

    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId,
        email: `preavis-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Préavis",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    userId = user!.id;

    const sci = await scisService.create(userId, {
      nom: "SCI Préavis",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Préavis",
      adresse: "1 rue du Préavis",
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
    vi.useRealTimers();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  describe("déclaration", () => {
    it("bail actif → préavis : date de fin confirmée, date proposée recalculée, auteur et audit enregistrés", async () => {
      const bailId = await bailAvecEcheances(["2027-02", "2027-03"]);

      // Proposée : 15/04 (réception + 3 mois) ; confirmée par Jimmy : 14/04.
      const resultat = await dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-14")));

      expect(resultat).toMatchObject({ bailId, statut: "preavis", dateFin: "2027-04-14" });
      expect(resultat.preavis).toMatchObject({
        auteur: "locataire",
        dateReception: "2027-01-15",
        modeRemise: "lrar",
        dureeMois: 3,
        motifReduit: null,
        dateFinProposee: "2027-04-15",
        dateFin: "2027-04-14",
        dateFinBailAvant: null,
        motifFin: null,
        declareePar: userId,
        archivedAt: null
      });
      expect(resultat.realignement).toEqual({
        echeancesRecalculees: [],
        echeancesArchivees: [],
        echeancesConservees: [],
        echeancesCreees: [],
        tropPercuMoisFin: null,
        tropPercuTotal: "0.00",
        resteARembourserTotal: "0.00"
      });
      const audit = await db.select().from(journalAudit).where(eq(journalAudit.entiteId, resultat.preavis!.id));
      expect(audit.map((ligne) => ligne.entiteType)).toEqual(["bail_preavis"]);
      const consulte = await dansMonOrganisation(() => preavisService.consulter(bailId));
      expect(consulte.actif?.id).toBe(resultat.preavis!.id);
      expect(consulte.historique).toEqual([]);
      await verifierCoherence(bailId);
    });

    it("préavis réduit (motif) sur un bail vide accepté", async () => {
      const bailId = await bailAvecEcheances(["2027-02"]);
      const resultat = await dansMonOrganisation(() =>
        preavisService.declarer(bailId, congeLocataire("2027-02-15", { dureeMois: 1, motifReduit: "mutation" }))
      );
      expect(resultat.preavis).toMatchObject({ motifReduit: "mutation", dureeMois: 1, dateFinProposee: "2027-02-15" });
      await verifierCoherence(bailId);
    });

    it("tardive, avril déjà généré plein et impayé : ramené au prorata 275,00 (250 + 25)", async () => {
      aujourdHui("2027-04-02");
      const bailId = await bailAvecEcheances(["2027-02", "2027-03", "2027-04"]);
      const avril = await echeanceDuMois(bailId, "2027-04");

      const resultat = await dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-15")));

      expect(await echeanceDuMois(bailId, "2027-04")).toMatchObject({
        id: avril.id,
        montant: "275.00",
        loyerHorsCharges: "250.00",
        charges: "25.00",
        statut: "impaye"
      });
      expect(resultat.realignement.echeancesRecalculees).toEqual([
        { paiementId: avril.id, montant: "275.00", loyerHorsCharges: "250.00", charges: "25.00", statut: "impaye" }
      ]);
      await verifierCoherence(bailId);
    });

    it("tardive, avril payé 550 € : inchangé, trop-perçu 275,00 signalé et visible dans les remboursements en attente", async () => {
      aujourdHui("2027-04-06");
      const bailId = await bailAvecEcheances(["2027-02", "2027-03", "2027-04"]);
      const avril = await echeanceDuMois(bailId, "2027-04");
      await verser(avril.id, "550.00", "2027-04-05");

      const resultat = await dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-15")));

      expect(await echeanceDuMois(bailId, "2027-04")).toMatchObject({ montant: "550.00", statut: "paye" });
      expect(resultat.realignement.tropPercuMoisFin).toEqual({
        paiementId: avril.id,
        tropPercu: "275.00",
        resteARembourser: "275.00"
      });
      expect(resultat.realignement.resteARembourserTotal).toBe("275.00");
      const enAttente = (await dansMonOrganisation(() => tableauDeBordService.getRemboursementsEnAttente())).filter(
        (r) => r.bailId === bailId
      );
      expect(enAttente).toEqual([{ bailId, paiementId: avril.id, montant: "275.00" }]);
    });

    it("refus : bail brouillon (409), déjà en préavis (409), rien n'est écrit", async () => {
      const brouillon = await dansMonOrganisation(() =>
        bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-10-01", loyerMensuel: "500.00", jourEcheance: 5 })
      );
      await expect(
        dansMonOrganisation(() => preavisService.declarer(brouillon.id, congeLocataire("2027-04-15")))
      ).rejects.toThrow(/Seul un bail actif/);
      await expect(
        dansMonOrganisation(() => preavisService.declarer(brouillon.id, congeLocataire("2027-04-15")))
      ).rejects.toThrow(ConflictException);
      expect(await db.select().from(bailPreavis).where(eq(bailPreavis.bailId, brouillon.id))).toEqual([]);

      const bailId = await bailAvecEcheances(["2027-02"]);
      await dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-15")));
      await expect(
        dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-30")))
      ).rejects.toThrow(/déjà en préavis/);
      await verifierCoherence(bailId);
    });

    it("refus 400, contrôlés contre le bail : motif pour un congé du bailleur, motif sur un meublé, fin avant la réception", async () => {
      const bailVide = await bailAvecEcheances(["2027-02"]);
      await expect(
        dansMonOrganisation(() =>
          preavisService.declarer(bailVide, congeLocataire("2027-07-15", { auteur: "bailleur", dureeMois: 6, motifReduit: "mutation" }))
        )
      ).rejects.toThrow(BadRequestException);
      await expect(
        dansMonOrganisation(() => preavisService.declarer(bailVide, congeLocataire("2027-01-14")))
      ).rejects.toThrow(/ne peut pas précéder la date de réception/);
      expect((await lireBail(bailVide)).statut).toBe("actif");
      await verifierCoherence(bailVide);
    });

    it("refus 400 : motif de préavis réduit sur un bail meublé (type lu dans baux)", async () => {
      const bailMeuble = await bailAvecEcheances(["2027-02"], "meuble");
      await expect(
        dansMonOrganisation(() =>
          preavisService.declarer(bailMeuble, congeLocataire("2027-02-15", { dureeMois: 1, motifReduit: "sante" }))
        )
      ).rejects.toThrow(/locataire sur un bail vide/);
    });

    it("deux échéances non archivées dans le mois de fin : 409, rien n'est écrit", async () => {
      aujourdHui("2027-04-02");
      const bailId = await bailAvecEcheances(["2027-02", "2027-03", "2027-04"]);
      await db
        .insert(paiements)
        .values({ bailId, type: "loyer", montant: "550.00", dateEcheance: "2027-04-20", loyerHorsCharges: "500.00", charges: "50.00" });
      const avant = await echeancesLoyer(bailId);

      await expect(dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-15")))).rejects.toThrow(
        /Plusieurs échéances de loyer \(2\)/
      );

      expect((await lireBail(bailId)).statut).toBe("actif");
      expect(await echeancesLoyer(bailId)).toEqual(avant);
      await verifierCoherence(bailId);
    });
  });

  describe("correction", () => {
    it("avancée (15/04 → 31/03, le 02/04) : avril proratisé archivé, ancienne ligne archivée « corrige »", async () => {
      aujourdHui("2027-04-02");
      const bailId = await bailAvecEcheances(["2027-02", "2027-03", "2027-04"]);
      await dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-15")));
      const avril = await echeanceDuMois(bailId, "2027-04");

      const resultat = await dansMonOrganisation(() => preavisService.corriger(bailId, congeLocataire("2027-03-31")));

      expect(resultat).toMatchObject({ statut: "preavis", dateFin: "2027-03-31" });
      expect(resultat.realignement.echeancesArchivees).toEqual([avril.id]);
      const [avrilApres] = await db.select().from(paiements).where(eq(paiements.id, avril.id));
      expect(avrilApres?.archivedAt).not.toBeNull();
      expect(await echeanceDuMois(bailId, "2027-03")).toMatchObject({ montant: "550.00" });
      const consulte = await dansMonOrganisation(() => preavisService.consulter(bailId));
      expect(consulte.actif).toMatchObject({ dateFin: "2027-03-31", dateFinBailAvant: null });
      expect(consulte.historique.map((ligne) => [ligne.dateFin, ligne.motifFin])).toEqual([["2027-04-15", "corrige"]]);
      await verifierCoherence(bailId);
    });

    it("reculée (15/04 → 15/05, le 10/05) : avril payé 275 remis plein (partiel), mai créé au prorata 266,12", async () => {
      aujourdHui("2027-04-02");
      const bailId = await bailAvecEcheances(["2027-02", "2027-03", "2027-04"]);
      await dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-15")));
      const avril = await echeanceDuMois(bailId, "2027-04");
      await verser(avril.id, "275.00", "2027-04-05");
      aujourdHui("2027-05-10");

      const resultat = await dansMonOrganisation(() => preavisService.corriger(bailId, congeLocataire("2027-05-15")));

      expect(await echeanceDuMois(bailId, "2027-04")).toMatchObject({
        montant: "550.00",
        loyerHorsCharges: "500.00",
        charges: "50.00",
        statut: "partiel"
      });
      expect(await echeanceDuMois(bailId, "2027-05")).toMatchObject({
        montant: "266.12",
        loyerHorsCharges: "241.93",
        charges: "24.19",
        dateEcheance: "2027-05-05",
        statut: "impaye"
      });
      expect(resultat.realignement.echeancesCreees).toHaveLength(1);
      expect(resultat.dateFin).toBe("2027-05-15");
      await verifierCoherence(bailId);
    });

    it("avancée puis reculée : avril gardé (payé) lors de l'avancée redevient dû en entier", async () => {
      aujourdHui("2027-04-02");
      const bailId = await bailAvecEcheances(["2027-02", "2027-03", "2027-04"]);
      await dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-15")));
      const avril = await echeanceDuMois(bailId, "2027-04");
      await verser(avril.id, "275.00", "2027-04-05");
      const avancee = await dansMonOrganisation(() => preavisService.corriger(bailId, congeLocataire("2027-03-31")));
      expect(avancee.realignement.echeancesConservees.map((c) => [c.paiementId, c.tropPercu])).toEqual([[avril.id, "275.00"]]);

      aujourdHui("2027-05-10");
      await dansMonOrganisation(() => preavisService.corriger(bailId, congeLocataire("2027-05-15")));

      expect(await echeanceDuMois(bailId, "2027-04")).toMatchObject({ montant: "550.00", statut: "partiel" });
      expect(await echeanceDuMois(bailId, "2027-05")).toMatchObject({ montant: "266.12" });
      await verifierCoherence(bailId);
    });

    it("sans préavis en cours : 409", async () => {
      const bailId = await bailAvecEcheances(["2027-02"]);
      await expect(dansMonOrganisation(() => preavisService.corriger(bailId, congeLocataire("2027-04-15")))).rejects.toThrow(
        /pas de préavis en cours/
      );
    });
  });

  describe("annulation", () => {
    it("le jour même de la date de fin (15/04, incluse) : avril proratisé remis plein, bail actif, date de fin du bail rétablie, ligne archivée « annule »", async () => {
      aujourdHui("2027-04-02");
      const bailId = await bailAvecEcheances(["2027-02", "2027-03", "2027-04"]);
      await dansMonOrganisation(() => bauxService.update(bailId, { dateFin: "2029-09-30" }));
      await dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-15")));
      expect((await lireBail(bailId)).dateFin).toBe("2027-04-15");
      aujourdHui("2027-04-15");

      const resultat = await dansMonOrganisation(() => preavisService.annuler(bailId));

      expect(resultat).toMatchObject({ statut: "actif", dateFin: "2029-09-30" });
      expect(resultat.preavis).toMatchObject({ motifFin: "annule", dateFinBailAvant: "2029-09-30" });
      expect(await echeanceDuMois(bailId, "2027-04")).toMatchObject({ montant: "550.00", statut: "impaye" });
      const consulte = await dansMonOrganisation(() => preavisService.consulter(bailId));
      expect(consulte.actif).toBeNull();
      expect(consulte.historique.map((ligne) => ligne.motifFin)).toEqual(["annule"]);
      await verifierCoherence(bailId);
    });

    it("après la date de fin du préavis : 409, rien ne change", async () => {
      aujourdHui("2027-04-02");
      const bailId = await bailAvecEcheances(["2027-02", "2027-03", "2027-04"]);
      await dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-15")));
      aujourdHui("2027-04-16");

      await expect(dansMonOrganisation(() => preavisService.annuler(bailId))).rejects.toThrow(/Le préavis est terminé/);
      expect((await lireBail(bailId)).statut).toBe("preavis");
      await verifierCoherence(bailId);
    });

    it("sans préavis en cours : 409", async () => {
      const bailId = await bailAvecEcheances(["2027-02"]);
      await expect(dansMonOrganisation(() => preavisService.annuler(bailId))).rejects.toThrow(/pas de préavis en cours/);
    });
  });

  describe("scoping : 404 pour une autre organisation, avant toute autre réponse", () => {
    it("consulter, déclarer (même invalide), corriger, annuler", async () => {
      const bailId = await bailAvecEcheances(["2027-02"]);
      await dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-15")));

      await expect(dansUneAutreOrganisation(() => preavisService.consulter(bailId))).rejects.toThrow(NotFoundException);
      await expect(
        dansUneAutreOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-01-01")))
      ).rejects.toThrow(NotFoundException);
      await expect(
        dansUneAutreOrganisation(() => preavisService.corriger(bailId, congeLocataire("2027-03-31")))
      ).rejects.toThrow(NotFoundException);
      await expect(dansUneAutreOrganisation(() => preavisService.annuler(bailId))).rejects.toThrow(NotFoundException);
      await expect(dansMonOrganisation(() => preavisService.consulter(randomUUID()))).rejects.toThrow(NotFoundException);

      expect((await lireBail(bailId)).dateFin).toBe("2027-04-15");
      await verifierCoherence(bailId);
    });
  });

  describe("compléments de la revue financial-logic-reviewer", () => {
    it("recul après un remboursement du mois gardé : 409 (règle non tranchée), rien n'est modifié", async () => {
      aujourdHui("2027-04-02");
      const bailId = await bailAvecEcheances(["2027-02", "2027-03", "2027-04"]);
      await dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-15")));
      const avril = await echeanceDuMois(bailId, "2027-04");
      await verser(avril.id, "275.00", "2027-04-05");
      await dansMonOrganisation(() => preavisService.corriger(bailId, congeLocataire("2027-03-31")));
      await dansMonOrganisation(() =>
        remboursementsService.create({
          bailId,
          paiementId: avril.id,
          type: "trop_percu",
          montantOrigine: "275.00",
          montantRembourse: "275.00",
          dateRemboursement: "2027-04-20",
          mode: "virement"
        })
      );
      aujourdHui("2027-05-10");
      const avant = await echeancesLoyer(bailId);

      await expect(
        dansMonOrganisation(() => preavisService.corriger(bailId, congeLocataire("2027-05-15")))
      ).rejects.toThrow("Un trop-perçu de l'échéance du 05/04/2027 a déjà été remboursé");

      expect(await echeancesLoyer(bailId)).toEqual(avant);
      expect((await lireBail(bailId)).dateFin).toBe("2027-03-31");
      await verifierCoherence(bailId);
    });

    it("déclaration avec une date de fin passée : mois de fin, mois gardé et mois archivé ; totaux additionnés sans double compte", async () => {
      aujourdHui("2027-06-10");
      const bailId = await bailAvecEcheances(["2027-02", "2027-03", "2027-04", "2027-05", "2027-06"]);
      const avril = await echeanceDuMois(bailId, "2027-04");
      const mai = await echeanceDuMois(bailId, "2027-05");
      const juin = await echeanceDuMois(bailId, "2027-06");
      await verser(avril.id, "550.00", "2027-04-05");
      await verser(mai.id, "550.00", "2027-05-05");

      const resultat = await dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-15")));

      expect(resultat.realignement.tropPercuMoisFin).toEqual({ paiementId: avril.id, tropPercu: "275.00", resteARembourser: "275.00" });
      expect(resultat.realignement.echeancesConservees.map((c) => [c.paiementId, c.tropPercu])).toEqual([[mai.id, "550.00"]]);
      expect(resultat.realignement.echeancesArchivees).toEqual([juin.id]);
      expect(resultat.realignement.tropPercuTotal).toBe("825.00");
      expect(resultat.realignement.resteARembourserTotal).toBe("825.00");
      await verifierCoherence(bailId);
    });

    it("déclaration, correction puis annulation : la date de fin d'origine du bail est rétablie ; audit de chaque action", async () => {
      aujourdHui("2027-04-02");
      const bailId = await bailAvecEcheances(["2027-02", "2027-03", "2027-04"]);
      await dansMonOrganisation(() => bauxService.update(bailId, { dateFin: "2029-09-30" }));
      const declaree = await dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-15")));
      const corrigee = await dansMonOrganisation(() => preavisService.corriger(bailId, congeLocataire("2027-04-30")));
      expect(corrigee.preavis?.dateFinBailAvant).toBe("2029-09-30");

      const annulee = await dansMonOrganisation(() => preavisService.annuler(bailId));

      expect(annulee).toMatchObject({ statut: "actif", dateFin: "2029-09-30" });
      const audit = await db.select().from(journalAudit).where(eq(journalAudit.entiteType, "bail_preavis"));
      const actions = audit
        .filter((ligne) => ligne.entiteId !== null && [declaree.preavis!.id, corrigee.preavis!.id].includes(ligne.entiteId))
        .map((ligne) => (ligne.donneesApres as { action: string }).action)
        .sort();
      expect(actions).toEqual(["annulation", "correction", "declaration"]);
      await verifierCoherence(bailId);
    });

    it("correction aux mêmes valeurs : aucune échéance modifiée ni créée, deux lignes dans l'historique", async () => {
      aujourdHui("2027-04-02");
      const bailId = await bailAvecEcheances(["2027-02", "2027-03", "2027-04"]);
      await dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-15")));
      const avant = await echeancesLoyer(bailId);

      const resultat = await dansMonOrganisation(() => preavisService.corriger(bailId, congeLocataire("2027-04-15")));

      expect(resultat.realignement).toMatchObject({
        echeancesRecalculees: [],
        echeancesArchivees: [],
        echeancesConservees: [],
        echeancesCreees: []
      });
      expect(await echeancesLoyer(bailId)).toEqual(avant);
      const consulte = await dansMonOrganisation(() => preavisService.consulter(bailId));
      expect(consulte.historique).toHaveLength(1);
      expect(consulte.actif).not.toBeNull();
    });

    it("job relancé le même mois après une annulation ou un recul : aucun doublon", async () => {
      aujourdHui("2027-04-02");
      const bailId = await bailAvecEcheances(["2027-02", "2027-03", "2027-04"]);
      await dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-15")));
      aujourdHui("2027-05-10");
      await dansMonOrganisation(() => preavisService.corriger(bailId, congeLocataire("2027-05-15")));
      await alertesJobService.genererEcheancesRecurrentes("2027-05-10");
      expect((await echeancesLoyer(bailId)).filter((e) => e.dateEcheance.startsWith("2027-05"))).toHaveLength(1);

      await dansMonOrganisation(() => preavisService.annuler(bailId));
      await alertesJobService.genererEcheancesRecurrentes("2027-05-11");
      expect((await echeancesLoyer(bailId)).filter((e) => e.dateEcheance.startsWith("2027-05"))).toHaveLength(1);
      expect(await echeanceDuMois(bailId, "2027-05")).toMatchObject({ montant: "550.00" });
    });

    it("date de fin du bail divergente de celle du préavis : correction et annulation refusées (409)", async () => {
      const bailId = await bailAvecEcheances(["2027-02"]);
      await dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-15")));
      await db.update(baux).set({ dateFin: "2027-04-30" }).where(eq(baux.id, bailId));

      await expect(dansMonOrganisation(() => preavisService.corriger(bailId, congeLocataire("2027-04-20")))).rejects.toThrow(
        /ne correspond plus à celle du préavis/
      );
      await expect(dansMonOrganisation(() => preavisService.annuler(bailId))).rejects.toThrow(
        /ne correspond plus à celle du préavis/
      );
    });
  });
});
