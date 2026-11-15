import { randomUUID } from "crypto";
import { ConflictException, Logger, NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  bailPreavis,
  baux,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
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
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { TableauDeBordModule } from "../tableau-de-bord/tableau-de-bord.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { VersementsModule } from "../versements/versements.module";
import { VersementsService } from "../versements/versements.service";
import { BauxModule } from "./baux.module";
import { BauxService } from "./baux.service";
import type { DeclarerPreavisDto } from "./dto/declarer-preavis.dto";
import { PreavisService } from "./preavis.service";

// Préavis d'un bail (résiliation, conception 2 « vrai préavis », commit 3b :
// job, resilier() et update() cohérents avec le préavis,
// décisions de Jimmy du 2026-11-15). Bail de l'audit : 550 € = 500 + 50,
// échéance le 5, entré le 01/10/2026 ; échéances des mois précédents
// produites par le vrai job, versements par le vrai VersementsService.
// La date du jour (Paris) est figée par test : seul `Date` est simulé
// (vi.useFakeTimers({ toFake: ["Date"] })), les minuteries restent réelles.
describe("Préavis : job, résiliation et modification du bail (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let bauxService: BauxService;
  let preavisService: PreavisService;
  let versementsService: VersementsService;
  let alertesJobService: AlertesJobService;
  let requestContextService: RequestContextService;
  let db: Database;
  let userId: string;
  let organisationId: string;
  let autreOrganisationId: string;
  let appartementId: string;
  let appartementsService: AppartementsService;
  let bienId: string;

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

  const congeBailleur = (dateFin: string): DeclarerPreavisDto => ({
    auteur: "bailleur",
    dateReception: "2027-01-10",
    modeRemise: "commissaire_justice",
    dureeMois: 6,
    motifReduit: null,
    dateFin
  });

  async function bailAvecEcheances(moisGeneres: string[], appartementCible: string = appartementId) {
    const bail = await dansMonOrganisation(() =>
      bauxService.create({
        appartementId: appartementCible,
        typeBail: "vide",
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
    appartementsService = moduleRef.get(AppartementsService);
    bauxService = moduleRef.get(BauxService);
    preavisService = moduleRef.get(PreavisService);
    versementsService = moduleRef.get(VersementsService);
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
    bienId = bien.id;
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
    vi.useRealTimers();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  describe("job de génération (décisions 2, 3 et 8)", () => {
    it("préavis fini le 15/04 : avril au prorata (275,00 = 250 + 25) le 01/04, rien en mai, aucun doublon", async () => {
      const bailId = await bailAvecEcheances(["2027-02", "2027-03"]);
      await dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-15")));

      await alertesJobService.genererEcheancesRecurrentes("2027-04-01");
      await alertesJobService.genererEcheancesRecurrentes("2027-04-02");
      await alertesJobService.genererEcheancesRecurrentes("2027-05-01");

      expect(await echeanceDuMois(bailId, "2027-04")).toMatchObject({
        montant: "275.00",
        loyerHorsCharges: "250.00",
        charges: "25.00",
        dateEcheance: "2027-04-05",
        statut: "impaye"
      });
      expect((await echeancesLoyer(bailId)).filter((e) => e.dateEcheance.startsWith("2027-04"))).toHaveLength(1);
      expect((await echeancesLoyer(bailId)).filter((e) => e.dateEcheance.startsWith("2027-05"))).toHaveLength(0);
    });

    it("bail ACTIF avec une date de fin : mois plein même après (comportement inchangé)", async () => {
      const bailId = await bailAvecEcheances(["2027-02", "2027-03"]);
      await dansMonOrganisation(() => bauxService.update(bailId, { dateFin: "2027-04-15" }));

      await alertesJobService.genererEcheancesRecurrentes("2027-04-01");
      await alertesJobService.genererEcheancesRecurrentes("2027-05-01");

      expect(await echeanceDuMois(bailId, "2027-04")).toMatchObject({ montant: "550.00" });
      expect(await echeanceDuMois(bailId, "2027-05")).toMatchObject({ montant: "550.00" });
    });

    it("congé du bailleur (fin 10/07) : mai plein, juillet au prorata (177,41 = 161,29 + 16,12)", async () => {
      aujourdHui("2027-01-20");
      const bailId = await bailAvecEcheances([]);
      await dansMonOrganisation(() => preavisService.declarer(bailId, congeBailleur("2027-07-10")));

      await alertesJobService.genererEcheancesRecurrentes("2027-05-01");
      await alertesJobService.genererEcheancesRecurrentes("2027-07-01");

      expect(await echeanceDuMois(bailId, "2027-05")).toMatchObject({ montant: "550.00" });
      expect(await echeanceDuMois(bailId, "2027-07")).toMatchObject({
        montant: "177.41",
        loyerHorsCharges: "161.29",
        charges: "16.12"
      });
    });

    it("un bail incohérent (préavis sans date de fin) est journalisé et sauté, sans bloquer les autres baux", async () => {
      const bailIncoherent = await bailAvecEcheances(["2027-02"]);
      await db.update(baux).set({ statut: "preavis", dateFin: null }).where(eq(baux.id, bailIncoherent));
      const autreAppartement = await appartementsService.create({
        bienId,
        numero: "2",
        type: "T2",
        nombrePiecesPrincipales: 2,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "500.00"
      });
      const bailNormal = await bailAvecEcheances(["2027-02"], autreAppartement.id);
      const espionErreur = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

      await alertesJobService.genererEcheancesRecurrentes("2027-03-01");

      // L'échec n'est jamais silencieux : journalisé en erreur, bail nommé.
      expect(espionErreur).toHaveBeenCalledWith(expect.stringContaining(bailIncoherent));
      espionErreur.mockRestore();

      expect((await echeancesLoyer(bailIncoherent)).filter((e) => e.dateEcheance.startsWith("2027-03"))).toHaveLength(0);
      expect(await echeanceDuMois(bailNormal, "2027-03")).toMatchObject({ montant: "550.00" });
    });
  });

  describe("résiliation d'un bail en préavis (audit §4, décisions 4 et 10)", () => {
    it("§4 a : à la date de fin du préavis — avril reste 275,00 (aucun double prorata), ligne archivée « resilie »", async () => {
      const bailId = await bailAvecEcheances(["2027-02", "2027-03"]);
      await dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-15")));
      await alertesJobService.genererEcheancesRecurrentes("2027-04-01");
      aujourdHui("2027-04-15");

      const resultat = await dansMonOrganisation(() => bauxService.resilier(bailId, { dateFin: "2027-04-15" }));

      expect(await echeanceDuMois(bailId, "2027-04")).toMatchObject({
        montant: "275.00",
        loyerHorsCharges: "250.00",
        charges: "25.00",
        statut: "impaye"
      });
      expect(resultat).toMatchObject({ statut: "resilie", tropPercu: null, echeancesArchivees: 0, tropPercuTotal: "0.00" });
      const consulte = await dansMonOrganisation(() => preavisService.consulter(bailId));
      expect(consulte.actif).toBeNull();
      expect(consulte.historique.map((ligne) => ligne.motifFin)).toEqual(["resilie"]);
      await verifierCoherence(bailId);
    });

    it("§4 b : avant la fin (relocation, résiliation au 31/03 le 02/04) — mars inchangé, avril proratisé archivé", async () => {
      const bailId = await bailAvecEcheances(["2027-02", "2027-03"]);
      await dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-15")));
      await alertesJobService.genererEcheancesRecurrentes("2027-04-01");
      const avril = await echeanceDuMois(bailId, "2027-04");
      aujourdHui("2027-04-02");

      const resultat = await dansMonOrganisation(() => bauxService.resilier(bailId, { dateFin: "2027-03-31" }));

      expect(await echeanceDuMois(bailId, "2027-03")).toMatchObject({ montant: "550.00" });
      const [avrilApres] = await db.select().from(paiements).where(eq(paiements.id, avril.id));
      expect(avrilApres?.archivedAt).not.toBeNull();
      expect(resultat.echeancesArchivees).toBe(1);
      await verifierCoherence(bailId);
    });

    it("§4 b : avril déjà payé 275 € — gardé, trop-perçu 275,00", async () => {
      const bailId = await bailAvecEcheances(["2027-02", "2027-03"]);
      await dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-15")));
      await alertesJobService.genererEcheancesRecurrentes("2027-04-01");
      const avril = await echeanceDuMois(bailId, "2027-04");
      aujourdHui("2027-04-06");
      await verser(avril.id, "275.00", "2027-04-05");

      const resultat = await dansMonOrganisation(() => bauxService.resilier(bailId, { dateFin: "2027-03-31" }));

      expect(resultat.echeancesConservees.map((c) => [c.paiementId, c.tropPercu])).toEqual([[avril.id, "275.00"]]);
      expect(resultat.resteARembourserTotal).toBe("275.00");
    });

    it("§4 c : congé du bailleur, départ réel le 20/05 — mai ramené à 354,83 (322,58 + 32,25), ligne archivée « resilie »", async () => {
      aujourdHui("2027-01-20");
      const bailId = await bailAvecEcheances([]);
      await dansMonOrganisation(() => preavisService.declarer(bailId, congeBailleur("2027-07-10")));
      for (const mois of ["2027-02", "2027-03", "2027-04", "2027-05"]) {
        await alertesJobService.genererEcheancesRecurrentes(`${mois}-01`);
      }
      aujourdHui("2027-05-20");

      await dansMonOrganisation(() => bauxService.resilier(bailId, { dateFin: "2027-05-20" }));

      expect(await echeanceDuMois(bailId, "2027-05")).toMatchObject({
        montant: "354.83",
        loyerHorsCharges: "322.58",
        charges: "32.25"
      });
      expect((await lireBail(bailId)).statut).toBe("resilie");
      await verifierCoherence(bailId);
    });

    it("mois de fin jamais généré (job non passé) : la résiliation le crée au prorata, décomposition comprise (Cas B)", async () => {
      const bailId = await bailAvecEcheances(["2027-02", "2027-03"]);
      await dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-15")));
      aujourdHui("2027-04-15");

      await dansMonOrganisation(() => bauxService.resilier(bailId, { dateFin: "2027-04-15" }));

      expect(await echeanceDuMois(bailId, "2027-04")).toMatchObject({
        montant: "275.00",
        loyerHorsCharges: "250.00",
        charges: "25.00",
        dateEcheance: "2027-04-15"
      });
      await verifierCoherence(bailId);
    });

    it("préavis incohérent (aucune ligne active, ou date de fin du bail divergente) : résiliation refusée (409)", async () => {
      const sansLigne = await bailAvecEcheances(["2027-02"]);
      await db.update(baux).set({ statut: "preavis", dateFin: "2027-04-15" }).where(eq(baux.id, sansLigne));
      await expect(dansMonOrganisation(() => bauxService.resilier(sansLigne, { dateFin: "2027-03-15" }))).rejects.toThrow(
        /Le préavis de ce bail est incohérent/
      );

      const autreAppartement = await appartementsService.create({
        bienId,
        numero: "3",
        type: "T2",
        nombrePiecesPrincipales: 2,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "500.00"
      });
      const divergent = await bailAvecEcheances(["2027-02"], autreAppartement.id);
      await dansMonOrganisation(() => preavisService.declarer(divergent, congeLocataire("2027-04-15")));
      await db.update(baux).set({ dateFin: "2027-05-31" }).where(eq(baux.id, divergent));
      await expect(dansMonOrganisation(() => bauxService.resilier(divergent, { dateFin: "2027-03-15" }))).rejects.toThrow(
        /Le préavis de ce bail est incohérent/
      );
      expect((await lireBail(divergent)).statut).toBe("preavis");
    });

    it("§4 d : après la fin du préavis — 409, rien ne change", async () => {
      const bailId = await bailAvecEcheances(["2027-02", "2027-03"]);
      await dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-15")));
      await alertesJobService.genererEcheancesRecurrentes("2027-04-01");
      aujourdHui("2027-05-20");
      const avant = await echeancesLoyer(bailId);

      await expect(dansMonOrganisation(() => bauxService.resilier(bailId, { dateFin: "2027-05-20" }))).rejects.toThrow(
        "Résiliez au plus tard à la date de fin du préavis (15/04/2027) : l'occupation au-delà relève d'une indemnité d'occupation, à gérer à part."
      );
      await expect(dansMonOrganisation(() => bauxService.resilier(bailId, { dateFin: "2027-05-20" }))).rejects.toThrow(
        ConflictException
      );

      // Une autre organisation : 404 avant ce refus, rien n'est révélé.
      await expect(
        dansUneAutreOrganisation(() => bauxService.resilier(bailId, { dateFin: "2027-05-20" }))
      ).rejects.toThrow(NotFoundException);

      expect((await lireBail(bailId)).statut).toBe("preavis");
      expect(await echeancesLoyer(bailId)).toEqual(avant);
      await verifierCoherence(bailId);
    });
  });

  describe("échéance archivée et job (décision 9 : jamais désarchivée)", () => {
    it("mois de fin dont l'échéance a été archivée avant la déclaration : le job ne génère rien ce mois-là", async () => {
      aujourdHui("2027-04-02");
      const bailId = await bailAvecEcheances(["2027-02", "2027-03", "2027-04"]);
      const avril = await echeanceDuMois(bailId, "2027-04");
      await db.update(paiements).set({ archivedAt: new Date() }).where(eq(paiements.id, avril.id));
      await dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-15")));

      await alertesJobService.genererEcheancesRecurrentes("2027-04-03");

      const avrilToutes = (await echeancesLoyer(bailId)).filter((e) => e.dateEcheance.startsWith("2027-04"));
      expect(avrilToutes).toHaveLength(1);
      expect(avrilToutes[0]?.archivedAt).not.toBeNull();
    });
  });

  describe("modification du bail (décision 12)", () => {
    it("date de fin refusée (409) pour un bail en préavis ; les autres champs restent modifiables", async () => {
      const bailId = await bailAvecEcheances(["2027-02"]);
      await dansMonOrganisation(() => preavisService.declarer(bailId, congeLocataire("2027-04-15")));

      await expect(dansMonOrganisation(() => bauxService.update(bailId, { dateFin: "2027-05-31" }))).rejects.toThrow(
        /se modifie depuis le préavis/
      );
      await dansMonOrganisation(() => bauxService.update(bailId, { honorairesBailleur: "100.00" }));

      expect((await lireBail(bailId)).dateFin).toBe("2027-04-15");
      await verifierCoherence(bailId);
    });

    it("bail actif : date de fin toujours modifiable", async () => {
      const bailId = await bailAvecEcheances(["2027-02"]);
      await dansMonOrganisation(() => bauxService.update(bailId, { dateFin: "2029-09-30" }));
      expect((await lireBail(bailId)).dateFin).toBe("2029-09-30");
    });
  });
});
