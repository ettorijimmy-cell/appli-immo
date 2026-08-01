import { randomUUID } from "crypto";
import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { ajouterMois, decomposerDate, formaterDateIso, joursDansLeMois } from "core";
import {
  alertes,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  documents,
  organisations,
  paiements,
  utilisateurs,
  type Database
} from "db";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { BauxModule } from "../baux/baux.module";
import { BauxService } from "../baux/baux.service";
import { CommonModule } from "../common/common.module";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { ImmeublesModule } from "../immeubles/immeubles.module";
import { ImmeublesService } from "../immeubles/immeubles.service";
import { PaiementsModule } from "../paiements/paiements.module";
import { PaiementsService } from "../paiements/paiements.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { DerniereSauvegardeService } from "./derniere-sauvegarde.service";
import { TableauDeBordModule } from "./tableau-de-bord.module";
import { TableauDeBordService } from "./tableau-de-bord.service";
import { VersementsModule } from "../versements/versements.module";
import { VersementsService } from "../versements/versements.service";
import { RemboursementsModule } from "../remboursements/remboursements.module";
import { RemboursementsService } from "../remboursements/remboursements.service";

// Vérifie le critère de complétion du Module 7 (docs/backlog.md) : voir en
// un coup d'œil s'il y a un impayé ou une échéance urgente, sans clic.
describe("Tableau de bord — agrégations (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let scisService: ScisService;
  let immeublesService: ImmeublesService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let paiementsService: PaiementsService;
  let versementsService: VersementsService;
  let remboursementsService: RemboursementsService;
  let tableauDeBordService: TableauDeBordService;
  let db: Database;
  let sciId: string;
  let immeubleId: string;

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
        ImmeublesModule,
        AppartementsModule,
        BauxModule,
        PaiementsModule,
        VersementsModule,
        RemboursementsModule,
        TableauDeBordModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    immeublesService = moduleRef.get(ImmeublesService);
    appartementsService = moduleRef.get(AppartementsService);
    bauxService = moduleRef.get(BauxService);
    paiementsService = moduleRef.get(PaiementsService);
    versementsService = moduleRef.get(VersementsService);
    remboursementsService = moduleRef.get(RemboursementsService);
    tableauDeBordService = moduleRef.get(TableauDeBordService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Dashboard Intégration" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `dashboard-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Dashboard",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }

    const sci = await scisService.create(user.id, { nom: "SCI Dashboard Test", regimeFiscal: "IR", adresse: "1 rue de Test", codePostal: "75001", ville: "Paris" });
    sciId = sci.id;
    const immeuble = await immeublesService.create({
      sciId: sci.id,
      nom: "Immeuble Dashboard Test",
      adresse: "1 rue du Dashboard",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    immeubleId = immeuble.id;
  });

  afterEach(async () => {
    await moduleRef.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  describe("getEnTete", () => {
    it("compte les biens par statut et somme la valeur locative des seuls biens loués", async () => {
      // Mesure un DELTA plutôt qu'un total absolu : la base de dev partagée
      // peut déjà contenir des lignes réelles issues de précédents tests
      // manuels dans Electron (Modules 4/6) — les compteurs globaux sont
      // volontairement non filtrés (c'est tout l'intérêt d'un tableau de
      // bord), donc le test doit tolérer un état initial non vide.
      const avant = await tableauDeBordService.getEnTete();

      await appartementsService.create({
        immeubleId,
        numero: "1",
        type: "T2",
        loyerReference: "800.00",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel"
      });
      await appartementsService.create({
        immeubleId,
        numero: "2",
        type: "T2",
        loyerReference: "700.00",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel"
      });
      const appartementVacant = await appartementsService.create({
        immeubleId,
        numero: "3",
        type: "T1",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "500.00"
      });
      const appartementTravaux = await appartementsService.create({
        immeubleId,
        numero: "4",
        type: "T1",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "600.00"
      });
      await appartementsService.update(appartementTravaux.id, { statut: "travaux" });

      // Loue les deux premiers via un vrai bail activé (transition réelle,
      // pas un statut forcé) — le troisième reste vacant par défaut.
      for (const numero of ["1", "2"]) {
        const tousLesAppartements = await appartementsService.findAll(immeubleId);
        const appartement = tousLesAppartements.find((a) => a.numero === numero)!;
        const bail = await bauxService.create({
          appartementId: appartement.id,
          typeBail: "vide",
          dateDebut: "2026-01-01",
          loyerMensuel: "800.00",
          jourEcheance: 5
        });
        await bauxService.activer(bail.id);
      }

      const apres = await tableauDeBordService.getEnTete();
      expect(apres.biensLoues - avant.biensLoues).toBe(2);
      expect(apres.biensVacants - avant.biensVacants).toBe(1);
      expect(apres.biensTravaux - avant.biensTravaux).toBe(1);
      // 800 + 700, jamais le vacant/travaux.
      expect(Number(apres.valeurLocativeTotale) - Number(avant.valeurLocativeTotale)).toBeCloseTo(1500, 2);
      void appartementVacant;
    });
  });

  describe("getCartes", () => {
    it("sépare impayés (échéance passée) et échéances à venir (échéance future), jamais les deux à la fois", async () => {
      const avant = await tableauDeBordService.getCartes();
      const appartement = await appartementsService.create({
        immeubleId,
        numero: "10",
        type: "T2",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "800.00"
      });
      const bail = await bauxService.create({
        appartementId: appartement.id,
        typeBail: "vide",
        dateDebut: "2020-01-01",
        loyerMensuel: "800.00",
        jourEcheance: 5
      });
      await bauxService.activer(bail.id);
      // Archive l'échéance d'entrée auto-générée pour isoler le scénario.
      for (const echeance of await paiementsService.findAll(bail.id)) {
        await paiementsService.archive(echeance.id);
      }

      const dansLePasse = "2020-06-05";
      const dansLeFutur = "2099-06-05";
      await db
        .insert(paiements)
        .values({ bailId: bail.id, type: "loyer", montant: "800.00", dateEcheance: dansLePasse });
      await db
        .insert(paiements)
        .values({ bailId: bail.id, type: "loyer", montant: "800.00", dateEcheance: dansLeFutur });

      const apres = await tableauDeBordService.getCartes();
      expect(apres.impayes.nombre - avant.impayes.nombre).toBe(1);
      expect(Number(apres.impayes.montantRestant) - Number(avant.impayes.montantRestant)).toBeCloseTo(800, 2);
      expect(apres.echeancesAVenir - avant.echeancesAVenir).toBe(1);
    });

    it("compte les documents expirés et les alertes actives", async () => {
      const avant = await tableauDeBordService.getCartes();
      await db.insert(documents).values({
        entiteType: "sci",
        entiteId: sciId,
        categorie: "assurance",
        dateExpiration: "2020-01-01",
        nomFichier: "assurance-expiree.pdf",
        mimeType: "application/pdf",
        tailleOctets: 10,
        cheminStockage: "x"
      });
      await db.insert(documents).values({
        entiteType: "sci",
        entiteId: sciId,
        categorie: "assurance",
        dateExpiration: "2099-01-01",
        nomFichier: "assurance-valide.pdf",
        mimeType: "application/pdf",
        tailleOctets: 10,
        cheminStockage: "x"
      });
      await db.insert(alertes).values({
        type: "bail_fin_proche",
        entiteId: randomUUID(),
        dateReference: "2026-08-01",
        message: "Test"
      });

      const apres = await tableauDeBordService.getCartes();
      expect(apres.documentsExpires - avant.documentsExpires).toBe(1);
      expect(apres.alertesActives - avant.alertesActives).toBe(1);
    });
  });

  describe("getRevenusLocatifs", () => {
    it("ventile loyer net et provisions par mois, basé sur date_versement, provisions exclues du loyer net", async () => {
      // Delta plutôt que valeur absolue : la base de dev partagée contient
      // déjà de vrais paiements réglés en juillet 2026 (tests manuels
      // Electron antérieurs) qui tomberaient dans la même période.
      const avant = await tableauDeBordService.getRevenusLocatifs("2026-07-01", "2026-08-31");
      const juilletAvant = avant.parMois.find((m) => m.mois === "2026-07")!;
      const aoutAvant = avant.parMois.find((m) => m.mois === "2026-08")!;

      const appartement = await appartementsService.create({
        immeubleId,
        numero: "20",
        type: "T2",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "900.00"
      });
      const bail = await bauxService.create({
        appartementId: appartement.id,
        typeBail: "vide",
        dateDebut: "2026-01-01",
        loyerMensuel: "900.00",
        provisionsCharges: "100.00",
        jourEcheance: 5
      });
      await bauxService.activer(bail.id);
      for (const echeance of await paiementsService.findAll(bail.id)) {
        await paiementsService.archive(echeance.id);
      }

      const paiementJuillet = await paiementsService.create({
        bailId: bail.id,
        type: "loyer",
        montant: "1000.00",
        dateEcheance: "2026-07-05"
      });
      await versementsService.ajouter({
        paiementId: paiementJuillet.id,
        montant: "1000.00",
        mode: "virement",
        dateVersement: "2026-07-05"
      });

      const paiementAout = await paiementsService.create({
        bailId: bail.id,
        type: "loyer",
        montant: "1000.00",
        dateEcheance: "2026-08-05"
      });
      await versementsService.ajouter({
        paiementId: paiementAout.id,
        montant: "1000.00",
        mode: "virement",
        dateVersement: "2026-08-05"
      });

      const apres = await tableauDeBordService.getRevenusLocatifs("2026-07-01", "2026-08-31");
      const juillet = apres.parMois.find((m) => m.mois === "2026-07")!;
      const aout = apres.parMois.find((m) => m.mois === "2026-08")!;
      expect(Number(juillet.loyerNet) - Number(juilletAvant.loyerNet)).toBeCloseTo(900, 2);
      expect(Number(juillet.provisions) - Number(juilletAvant.provisions)).toBeCloseTo(100, 2);
      expect(Number(aout.loyerNet) - Number(aoutAvant.loyerNet)).toBeCloseTo(900, 2);
      expect(Number(aout.provisions) - Number(aoutAvant.provisions)).toBeCloseTo(100, 2);
      expect(Number(apres.totalLoyerNet) - Number(avant.totalLoyerNet)).toBeCloseTo(1800, 2);
      expect(Number(apres.totalProvisions) - Number(avant.totalProvisions)).toBeCloseTo(200, 2);
    });

    it("inclut chaque mois de la période dans le résultat (valeur par défaut 0), pas seulement les mois avec des données", async () => {
      // Période choisie loin de toute donnée réelle connue (voir le test
      // ci-dessus, qui documente les seules dates réelles présentes dans la
      // base de dev partagée) — ici on vérifie juste la structure (un
      // élément par mois), pas l'absence totale de revenu.
      const revenus = await tableauDeBordService.getRevenusLocatifs("2019-01-01", "2019-03-31");
      expect(revenus.parMois.map((m) => m.mois)).toEqual(["2019-01", "2019-02", "2019-03"]);
      expect(revenus.parMois.every((m) => m.loyerNet === "0.00")).toBe(true);
    });
  });

  describe("getSynthese", () => {
    it("calcule un revenu net et un taux d'occupation cohérents pour un appartement continuellement loué", async () => {
      const appartement = await appartementsService.create({
        immeubleId,
        numero: "30",
        type: "T2",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "800.00"
      });
      const bail = await bauxService.create({
        appartementId: appartement.id,
        typeBail: "vide",
        dateDebut: "2026-01-01",
        loyerMensuel: "800.00",
        jourEcheance: 5
      });
      await bauxService.activer(bail.id);
      for (const echeance of await paiementsService.findAll(bail.id)) {
        await paiementsService.archive(echeance.id);
      }

      const paiement = await paiementsService.create({
        bailId: bail.id,
        type: "loyer",
        montant: "800.00",
        dateEcheance: "2026-01-05"
      });
      await versementsService.ajouter({
        paiementId: paiement.id,
        montant: "800.00",
        mode: "virement",
        dateVersement: "2026-01-10"
      });

      const synthese = await tableauDeBordService.getSynthese("2026-01-01", "2026-01-31");
      const sci = synthese.find((s) => s.id === sciId)!;
      const immeuble = sci.immeubles.find((i) => i.id === immeubleId)!;
      const appartementResultat = immeuble.appartements.find((a) => a.id === appartement.id)!;

      expect(appartementResultat.revenuNet).toBe("800.00");
      expect(appartementResultat.tauxOccupation).toBe(1); // occupé tout janvier
      expect(immeuble.tauxOccupation).toBe(1);
      expect(sci.tauxOccupation).toBe(1);
    });

    it("un appartement jamais loué a un taux d'occupation de 0 et un revenu net de 0", async () => {
      await appartementsService.create({
        immeubleId,
        numero: "31",
        type: "T1",
        loyerReference: "500.00",
        nombrePiecesPrincipales: 2,
        modeChauffage: "individuel",
        modeEauChaude: "individuel"
      });

      const synthese = await tableauDeBordService.getSynthese("2026-01-01", "2026-01-31");
      const sci = synthese.find((s) => s.id === sciId)!;
      const immeuble = sci.immeubles.find((i) => i.id === immeubleId)!;
      const appartementResultat = immeuble.appartements.find((a) => a.numero === "31")!;

      expect(appartementResultat.revenuNet).toBe("0.00");
      expect(appartementResultat.tauxOccupation).toBe(0);
    });

    it("moyenne pondérée correcte au niveau immeuble avec plusieurs appartements à taux d'occupation différents", async () => {
      const appartementOccupe = await appartementsService.create({
        immeubleId,
        numero: "40",
        type: "T2",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "800.00"
      });
      const bailOccupe = await bauxService.create({
        appartementId: appartementOccupe.id,
        typeBail: "vide",
        dateDebut: "2026-01-01",
        loyerMensuel: "800.00",
        jourEcheance: 5
      });
      await bauxService.activer(bailOccupe.id);
      for (const echeance of await paiementsService.findAll(bailOccupe.id)) {
        await paiementsService.archive(echeance.id);
      }
      // Second appartement, jamais loué sur la période (0% d'occupation).
      await appartementsService.create({
        immeubleId,
        numero: "41",
        type: "T1",
        loyerReference: "500.00",
        nombrePiecesPrincipales: 2,
        modeChauffage: "individuel",
        modeEauChaude: "individuel"
      });

      const synthese = await tableauDeBordService.getSynthese("2026-01-01", "2026-01-31");
      const sci = synthese.find((s) => s.id === sciId)!;
      const immeuble = sci.immeubles.find((i) => i.id === immeubleId)!;
      const occupe = immeuble.appartements.find((a) => a.numero === "40")!;
      const vacant = immeuble.appartements.find((a) => a.numero === "41")!;

      expect(occupe.tauxOccupation).toBe(1);
      expect(vacant.tauxOccupation).toBe(0);
      // Chaque test tourne dans sa propre transaction isolée (rollback
      // après coup) : seuls ces deux appartements existent ici, la moyenne
      // pondérée par appartement doit donc être exactement 0.5.
      expect(immeuble.appartements).toHaveLength(2);
      expect(immeuble.tauxOccupation).toBeCloseTo(0.5, 4);
      expect(sci.tauxOccupation).toBeCloseTo(0.5, 4);
    });

    it("scénario A102 : un appartement archivé APRÈS avoir perçu un loyer reste compté dans les totaux SCI/immeuble, jamais silencieusement exclu", async () => {
      const appartement = await appartementsService.create({
        immeubleId,
        numero: "A102",
        type: "T2",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "800.00"
      });
      const bail = await bauxService.create({
        appartementId: appartement.id,
        typeBail: "vide",
        dateDebut: "2026-01-01",
        loyerMensuel: "800.00",
        jourEcheance: 5
      });
      await bauxService.activer(bail.id);
      for (const echeance of await paiementsService.findAll(bail.id)) {
        await paiementsService.archive(echeance.id);
      }

      // Loyer de juin encaissé pendant que l'appartement est encore actif.
      const paiementJuin = await paiementsService.create({
        bailId: bail.id,
        type: "loyer",
        montant: "800.00",
        dateEcheance: "2026-06-05"
      });
      await versementsService.ajouter({
        paiementId: paiementJuin.id,
        montant: "800.00",
        mode: "virement",
        dateVersement: "2026-06-10"
      });

      // Puis, APRÈS cet encaissement : le locataire part, le bail est
      // résilié, et l'appartement lui-même est archivé (bien retiré du
      // portefeuille — vente, démolition...).
      await bauxService.resilier(bail.id, { dateFin: "2026-06-30" });
      await appartementsService.archive(appartement.id);

      // Le tableau de bord est consulté APRÈS cet archivage, pour la
      // période où le loyer a été perçu.
      const revenus = await tableauDeBordService.getRevenusLocatifs("2026-06-01", "2026-06-30");
      const synthese = await tableauDeBordService.getSynthese("2026-06-01", "2026-06-30");

      const sci = synthese.find((s) => s.id === sciId)!;
      const immeuble = sci.immeubles.find((i) => i.id === immeubleId)!;
      const appartementResultat = immeuble.appartements.find((a) => a.id === appartement.id)!;

      // L'appartement archivé reste présent, marqué comme tel, avec son
      // vrai revenu — jamais silencieusement absent de la liste.
      expect(appartementResultat).toBeDefined();
      expect(appartementResultat.archive).toBe(true);
      expect(appartementResultat.revenuNet).toBe("800.00");

      // Les deux écrans du tableau de bord doivent afficher EXACTEMENT le
      // même total pour cette période — c'est le garde-fou contre la
      // divergence silencieuse identifiée avant cette correction.
      expect(immeuble.revenuNet).toBe(revenus.totalLoyerNet);
      expect(sci.revenuNet).toBe(revenus.totalLoyerNet);
      expect(immeuble.revenuNet).toBe("800.00");
    });

    it("un appartement archivé est exclu du dénominateur du taux d'occupation moyen pour une période postérieure à son archivage, pas compté comme 0 %", async () => {
      // Fenêtre interrogée calculée depuis "aujourd'hui" (jamais une date
      // fixe codée en dur, qui finit toujours par être dépassée par le
      // temps qui passe — bug réel constaté le jour où l'horloge a
      // rattrapé une échéance figée en 2026-08). Le mois calendaire
      // entier commençant 2 mois après aujourd'hui est systématiquement
      // postérieur au moment réel de l'archivage ci-dessous, quelle que
      // soit la date d'exécution du test.
      const aujourdhui = new Date().toISOString().slice(0, 10);
      const { annee, mois } = decomposerDate(aujourdhui);
      const debutPeriode = ajouterMois(formaterDateIso(annee, mois, 1), 2);
      const { annee: anneeCible, mois: moisCible } = decomposerDate(debutPeriode);
      const finPeriode = formaterDateIso(anneeCible, moisCible, joursDansLeMois(anneeCible, moisCible));

      // Appartement témoin : bail actif couvrant toute la période
      // interrogée -> occupation réelle 100 % sur cette période.
      const appartementTemoin = await appartementsService.create({
        immeubleId,
        numero: "A200",
        type: "T2",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "700.00"
      });
      const bailTemoin = await bauxService.create({
        appartementId: appartementTemoin.id,
        typeBail: "vide",
        dateDebut: aujourdhui,
        loyerMensuel: "700.00",
        jourEcheance: 5
      });
      await bauxService.activer(bailTemoin.id);

      // Appartement archivé (aujourd'hui, jamais occupé pendant la période
      // interrogée ci-dessous, qui se situe entièrement dans le futur par
      // rapport à cet archivage) : retiré du parc AVANT que la période ne
      // commence.
      const appartementArchive = await appartementsService.create({
        immeubleId,
        numero: "A201",
        type: "T2",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "700.00"
      });
      await appartementsService.archive(appartementArchive.id);

      // Période interrogée entièrement postérieure à l'archivage.
      const synthese = await tableauDeBordService.getSynthese(debutPeriode, finPeriode);
      const sci = synthese.find((s) => s.id === sciId)!;
      const immeuble = sci.immeubles.find((i) => i.id === immeubleId)!;

      const resultatArchive = immeuble.appartements.find((a) => a.id === appartementArchive.id)!;
      const resultatTemoin = immeuble.appartements.find((a) => a.id === appartementTemoin.id)!;

      // L'appartement archivé reste listé (pour l'affichage détaillé), avec
      // une occupation nulle sur cette période.
      expect(resultatArchive.archive).toBe(true);
      expect(resultatArchive.tauxOccupation).toBe(0);
      expect(resultatTemoin.tauxOccupation).toBe(1);

      // Sans l'exclusion du dénominateur, la moyenne serait (0 + 1) / 2 =
      // 0.5 : un bien retiré du parc avant même le début de la période ne
      // doit jamais diluer ainsi le taux d'occupation réel de l'immeuble
      // (ni de la SCI).
      expect(immeuble.tauxOccupation).toBe(1);
      expect(sci.tauxOccupation).toBe(1);
    });
  });

  describe("getRemboursementsEnAttente", () => {
    it("signale un trop-perçu tant qu'aucun remboursement ne le couvre", async () => {
      const appartement = await appartementsService.create({
        immeubleId,
        numero: "40",
        type: "T2",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "900.00"
      });
      const bail = await bauxService.create({
        appartementId: appartement.id,
        typeBail: "vide",
        dateDebut: "2026-08-01",
        loyerMensuel: "900.00",
        jourEcheance: 1
      });
      await bauxService.activer(bail.id);
      const [echeanceEntree] = await paiementsService.findAll(bail.id);
      if (!echeanceEntree) {
        throw new Error("Échéance d'entrée introuvable");
      }
      // Échéance d'entrée réglée intégralement, puis résiliation le même
      // mois (même mois calendaire) : 900 reçus pour 900/31*15 = ~435
      // vraiment dus -> trop-perçu.
      await versementsService.ajouter({
        paiementId: echeanceEntree.id,
        montant: "900.00",
        mode: "virement",
        dateVersement: "2026-08-01"
      });
      const resiliation = await bauxService.resilier(bail.id, { dateFin: "2026-08-15" });
      expect(resiliation.tropPercu).not.toBeNull();

      const enAttente = await tableauDeBordService.getRemboursementsEnAttente();
      const pourCeBail = enAttente.find((r) => r.bailId === bail.id);
      expect(pourCeBail).toBeDefined();
      expect(pourCeBail?.montant).toBe(resiliation.tropPercu?.montant);
    });

    it("disparaît une fois qu'un remboursement couvre intégralement le trop-perçu", async () => {
      const appartement = await appartementsService.create({
        immeubleId,
        numero: "41",
        type: "T2",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "900.00"
      });
      const bail = await bauxService.create({
        appartementId: appartement.id,
        typeBail: "vide",
        dateDebut: "2026-08-01",
        loyerMensuel: "900.00",
        jourEcheance: 1
      });
      await bauxService.activer(bail.id);
      const [echeanceEntree] = await paiementsService.findAll(bail.id);
      if (!echeanceEntree) {
        throw new Error("Échéance d'entrée introuvable");
      }
      await versementsService.ajouter({
        paiementId: echeanceEntree.id,
        montant: "900.00",
        mode: "virement",
        dateVersement: "2026-08-01"
      });
      const resiliation = await bauxService.resilier(bail.id, { dateFin: "2026-08-15" });
      if (!resiliation.tropPercu) {
        throw new Error("Trop-perçu attendu pour ce scénario");
      }

      await remboursementsService.create({
        bailId: bail.id,
        paiementId: resiliation.tropPercu.paiementId,
        type: "trop_percu",
        montantOrigine: resiliation.tropPercu.montant,
        montantRembourse: resiliation.tropPercu.montant,
        dateRemboursement: "2026-09-01",
        mode: "virement"
      });

      const enAttente = await tableauDeBordService.getRemboursementsEnAttente();
      expect(enAttente.find((r) => r.bailId === bail.id)).toBeUndefined();
    });

    it("reste visible même si l'appartement est archivé après la résiliation (même principe que le fix Module 7)", async () => {
      const appartement = await appartementsService.create({
        immeubleId,
        numero: "42",
        type: "T2",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "900.00"
      });
      const bail = await bauxService.create({
        appartementId: appartement.id,
        typeBail: "vide",
        dateDebut: "2026-08-01",
        loyerMensuel: "900.00",
        jourEcheance: 1
      });
      await bauxService.activer(bail.id);
      const [echeanceEntree] = await paiementsService.findAll(bail.id);
      if (!echeanceEntree) {
        throw new Error("Échéance d'entrée introuvable");
      }
      await versementsService.ajouter({
        paiementId: echeanceEntree.id,
        montant: "900.00",
        mode: "virement",
        dateVersement: "2026-08-01"
      });
      await bauxService.resilier(bail.id, { dateFin: "2026-08-15" });

      // Archivage APRÈS la résiliation : le trop-perçu doit rester visible.
      await appartementsService.archive(appartement.id);
      await bauxService.archive(bail.id);

      const enAttente = await tableauDeBordService.getRemboursementsEnAttente();
      expect(enAttente.find((r) => r.bailId === bail.id)).toBeDefined();
    });

    it("ne signale rien pour un bail résilié sans trop-perçu", async () => {
      const appartement = await appartementsService.create({
        immeubleId,
        numero: "43",
        type: "T2",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "900.00"
      });
      const bail = await bauxService.create({
        appartementId: appartement.id,
        typeBail: "vide",
        dateDebut: "2026-08-01",
        loyerMensuel: "900.00",
        jourEcheance: 1
      });
      await bauxService.activer(bail.id);
      // Aucun versement : rien n'a été reçu, donc aucun trop-perçu possible.
      await bauxService.resilier(bail.id, { dateFin: "2026-08-15" });

      const enAttente = await tableauDeBordService.getRemboursementsEnAttente();
      expect(enAttente.find((r) => r.bailId === bail.id)).toBeUndefined();
    });
  });

  describe("DerniereSauvegardeService", () => {
    it("retrouve la sauvegarde la plus récente à partir du nom de fichier", async () => {
      const dossierTest = await mkdtemp(path.join(os.tmpdir(), "appli-immo-test-backups-"));
      try {
        await writeFile(path.join(dossierTest, "appli_immo_dev_20260101-100000.sql"), "x");
        await writeFile(path.join(dossierTest, "appli_immo_dev_20260715-153000.sql"), "x");
        await writeFile(path.join(dossierTest, "fichier-non-reconnu.txt"), "x");

        process.env["BACKUPS_DIR"] = dossierTest;
        const service = new DerniereSauvegardeService({ get: () => dossierTest } as never);
        const resultat = await service.getDerniereSauvegarde();
        expect(resultat.dateIso).toBe("2026-07-15T15:30:00");
      } finally {
        await rm(dossierTest, { recursive: true, force: true });
        delete process.env["BACKUPS_DIR"];
      }
    });

    it("retourne null si le dossier de sauvegardes n'existe pas", async () => {
      const service = new DerniereSauvegardeService({ get: () => "/chemin/qui/n-existe-pas-vraiment" } as never);
      const resultat = await service.getDerniereSauvegarde();
      expect(resultat.dateIso).toBeNull();
    });
  });
});
