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
import { BailLocatairesModule } from "../bail-locataires/bail-locataires.module";
import { BailLocatairesService } from "../bail-locataires/bail-locataires.service";
import { BauxModule } from "../baux/baux.module";
import { BauxService } from "../baux/baux.service";
import { CommonModule } from "../common/common.module";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { GarantsModule } from "../garants/garants.module";
import { GarantsService } from "../garants/garants.service";
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
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
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let paiementsService: PaiementsService;
  let versementsService: VersementsService;
  let remboursementsService: RemboursementsService;
  let locatairesService: LocatairesService;
  let garantsService: GarantsService;
  let bailLocatairesService: BailLocatairesService;
  let tableauDeBordService: TableauDeBordService;
  let db: Database;
  let userId: string;
  let sciId: string;
  let bienId: string;

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
        TableauDeBordModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    bienService = moduleRef.get(BienService);
    locatairesService = moduleRef.get(LocatairesService);
    garantsService = moduleRef.get(GarantsService);
    bailLocatairesService = moduleRef.get(BailLocatairesService);
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

    userId = user.id;
    const sci = await scisService.create(user.id, { nom: "SCI Dashboard Test", regimeFiscal: "IR", adresse: "1 rue de Test", codePostal: "75001", ville: "Paris" });
    sciId = sci.id;
    const bien = await bienService.create(user.id, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Dashboard Test",
      adresse: "1 rue du Dashboard",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    bienId = bien.id;
  });

  afterEach(async () => {
    await moduleRef?.close();
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
        bienId,
        numero: "1",
        type: "T2",
        loyerReference: "800.00",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel"
      });
      await appartementsService.create({
        bienId,
        numero: "2",
        type: "T2",
        loyerReference: "700.00",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel"
      });
      const appartementVacant = await appartementsService.create({
        bienId,
        numero: "3",
        type: "T1",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "500.00"
      });
      const appartementTravaux = await appartementsService.create({
        bienId,
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
        const tousLesAppartements = await appartementsService.findAll(bienId);
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
        bienId,
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
        bienId,
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

    // Module Charges et fiscalité, Étape 3 (docs/backlog.md) : filtre
    // bien/sci du cockpit "Comptabilité" — vérifie que le filtre restreint
    // réellement le CALCUL (pas un simple filtre visuel côté frontend).
    describe("filtre bienId/sciId", () => {
      async function creerBienAvecRevenu(
        proprietaire: { proprietaireType: "sci"; sciId: string } | { proprietaireType: "personne_physique" },
        loyerMensuel: string,
        numero: string
      ) {
        const bienCree = await bienService.create(userId, {
          type: "maison",
          ...(proprietaire.proprietaireType === "sci"
            ? { proprietaireType: "sci" as const, sciId: proprietaire.sciId }
            : { proprietaireType: "personne_physique" as const, nomProprietaire: "Jean Dupont" }),
          adresse: `${numero} rue du Filtre`,
          codePostal: "75001",
          ville: "Paris"
        });
        const appartement = await appartementsService.create({
          bienId: bienCree.id,
          numero,
          type: "T2",
          nombrePiecesPrincipales: 3,
          modeChauffage: "individuel",
          modeEauChaude: "individuel",
          loyerReference: loyerMensuel
        });
        const bail = await bauxService.create({
          appartementId: appartement.id,
          typeBail: "vide",
          dateDebut: "2026-01-01",
          loyerMensuel,
          jourEcheance: 5
        });
        await bauxService.activer(bail.id);
        for (const echeance of await paiementsService.findAll(bail.id)) {
          await paiementsService.archive(echeance.id);
        }
        const paiement = await paiementsService.create({
          bailId: bail.id,
          type: "loyer",
          montant: loyerMensuel,
          dateEcheance: "2026-05-05"
        });
        await versementsService.ajouter({
          paiementId: paiement.id,
          montant: loyerMensuel,
          mode: "virement",
          dateVersement: "2026-05-05"
        });
        return bienCree;
      }

      it("filtre par bienId isole le revenu de ce seul bien", async () => {
        const autreSci = await scisService.create(userId, {
          nom: "SCI Filtre Autre",
          regimeFiscal: "IR",
          adresse: "1 rue de Test",
          codePostal: "75001",
          ville: "Paris"
        });
        const bienA = await creerBienAvecRevenu({ proprietaireType: "sci", sciId }, "500.00", "F1");
        await creerBienAvecRevenu({ proprietaireType: "sci", sciId: autreSci.id }, "700.00", "F2");

        const revenus = await tableauDeBordService.getRevenusLocatifs("2026-05-01", "2026-05-31", {
          bienId: bienA.id
        });
        expect(revenus.totalLoyerNet).toBe("500.00");
      });

      it("filtre par sciId isole le revenu de tous les biens de cette SCI", async () => {
        const sciCible = await scisService.create(userId, {
          nom: "SCI Filtre Cible",
          regimeFiscal: "IR",
          adresse: "1 rue de Test",
          codePostal: "75001",
          ville: "Paris"
        });
        await creerBienAvecRevenu({ proprietaireType: "sci", sciId: sciCible.id }, "500.00", "F3");
        await creerBienAvecRevenu({ proprietaireType: "sci", sciId: sciCible.id }, "300.00", "F4");
        await creerBienAvecRevenu({ proprietaireType: "sci", sciId }, "999.00", "F5");

        const revenus = await tableauDeBordService.getRevenusLocatifs("2026-05-01", "2026-05-31", {
          sciId: sciCible.id
        });
        expect(revenus.totalLoyerNet).toBe("800.00");
      });

      // getSynthese (endpoint voisin) exclut explicitement les biens en nom
      // propre de sa hiérarchie SCI — ce filtre-ci doit rester correct pour
      // CE cas précis, contrairement à getSynthese, puisque le cockpit
      // "Comptabilité" doit pouvoir filtrer sur n'importe quel bien.
      it("filtre par bienId fonctionne pour un bien en nom propre (sans SCI)", async () => {
        const bienNomPropre = await creerBienAvecRevenu({ proprietaireType: "personne_physique" }, "600.00", "F6");
        await creerBienAvecRevenu({ proprietaireType: "sci", sciId }, "999.00", "F7");

        const revenus = await tableauDeBordService.getRevenusLocatifs("2026-05-01", "2026-05-31", {
          bienId: bienNomPropre.id
        });
        expect(revenus.totalLoyerNet).toBe("600.00");
      });

      it("sans filtre, inclut tous les biens (comportement inchangé)", async () => {
        const avant = await tableauDeBordService.getRevenusLocatifs("2026-05-01", "2026-05-31");
        await creerBienAvecRevenu({ proprietaireType: "sci", sciId }, "500.00", "F8");
        await creerBienAvecRevenu({ proprietaireType: "personne_physique" }, "300.00", "F9");

        const apres = await tableauDeBordService.getRevenusLocatifs("2026-05-01", "2026-05-31");
        expect(Number(apres.totalLoyerNet) - Number(avant.totalLoyerNet)).toBeCloseTo(800, 2);
      });
    });
  });

  describe("getSynthese", () => {
    it("calcule un revenu net et un taux d'occupation cohérents pour un appartement continuellement loué", async () => {
      const appartement = await appartementsService.create({
        bienId,
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
      const immeuble = sci.biens.find((i) => i.id === bienId)!;
      const appartementResultat = immeuble.appartements.find((a) => a.id === appartement.id)!;

      expect(appartementResultat.revenuNet).toBe("800.00");
      expect(appartementResultat.tauxOccupation).toBe(1); // occupé tout janvier
      expect(immeuble.tauxOccupation).toBe(1);
      expect(sci.tauxOccupation).toBe(1);
    });

    it("un appartement jamais loué a un taux d'occupation de 0 et un revenu net de 0", async () => {
      await appartementsService.create({
        bienId,
        numero: "31",
        type: "T1",
        loyerReference: "500.00",
        nombrePiecesPrincipales: 2,
        modeChauffage: "individuel",
        modeEauChaude: "individuel"
      });

      const synthese = await tableauDeBordService.getSynthese("2026-01-01", "2026-01-31");
      const sci = synthese.find((s) => s.id === sciId)!;
      const immeuble = sci.biens.find((i) => i.id === bienId)!;
      const appartementResultat = immeuble.appartements.find((a) => a.numero === "31")!;

      expect(appartementResultat.revenuNet).toBe("0.00");
      expect(appartementResultat.tauxOccupation).toBe(0);
    });

    it("moyenne pondérée correcte au niveau immeuble avec plusieurs appartements à taux d'occupation différents", async () => {
      const appartementOccupe = await appartementsService.create({
        bienId,
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
        bienId,
        numero: "41",
        type: "T1",
        loyerReference: "500.00",
        nombrePiecesPrincipales: 2,
        modeChauffage: "individuel",
        modeEauChaude: "individuel"
      });

      const synthese = await tableauDeBordService.getSynthese("2026-01-01", "2026-01-31");
      const sci = synthese.find((s) => s.id === sciId)!;
      const immeuble = sci.biens.find((i) => i.id === bienId)!;
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
        bienId,
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
      const immeuble = sci.biens.find((i) => i.id === bienId)!;
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
        bienId,
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
        bienId,
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
      const immeuble = sci.biens.find((i) => i.id === bienId)!;

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
        bienId,
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
        bienId,
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
        bienId,
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
        bienId,
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

  // Écriture directe en base : seule la présence catégorisée compte ici, pas
  // le cycle d'upload chiffré complet (même principe que
  // bail-document-docx.integration.spec.ts). Partagée entre
  // getChecklistDocumentaire et getCompletudeDocumentaire — même détection
  // réutilisée côté service (evaluerCompletudeCategories, packages/core).
  async function creerDocumentTest(
    entiteType: "appartement" | "bien" | "locataire" | "garant",
    entiteId: string,
    categorie: "dpe" | "elec_gaz" | "crep_plomb" | "erp" | "piece_identite",
    options: { archive?: boolean; dateExpiration?: string } = {}
  ) {
    await db.insert(documents).values({
      entiteType,
      entiteId,
      categorie,
      nomFichier: "test.pdf",
      mimeType: "application/pdf",
      tailleOctets: 1,
      cheminStockage: `test/${randomUUID()}.enc`,
      archivedAt: options.archive ? new Date() : null,
      dateExpiration: options.dateExpiration ?? null
    });
  }

  describe("getChecklistDocumentaire", () => {
    it("appartement : signale les 4 catégories manquantes, les retire une à une (immeuble parent inclus), ignore un CREP expiré", async () => {
      const appartement = await appartementsService.create({
        bienId,
        numero: "50",
        type: "T2",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "700.00"
      });

      let checklist = await tableauDeBordService.getChecklistDocumentaire();
      let entree = checklist.appartements.find((a) => a.appartementId === appartement.id);
      expect(entree?.categoriesManquantes.slice().sort()).toEqual(["crep_plomb", "dpe", "elec_gaz", "erp"]);

      // DPE rattaché à l'appartement lui-même.
      await creerDocumentTest("appartement", appartement.id, "dpe");
      // Élec/gaz rattaché à l'IMMEUBLE parent — même logique de détection
      // que BailDocumentDocxService (immeuble ou appartement, indifféremment).
      await creerDocumentTest("bien", bienId, "elec_gaz");
      // CREP présent mais expiré : compte comme MANQUANT pour la checklist
      // (contrairement à l'annexe du bail, qui ne regarde que l'archivage).
      await creerDocumentTest("appartement", appartement.id, "crep_plomb", { dateExpiration: "2020-01-01" });

      checklist = await tableauDeBordService.getChecklistDocumentaire();
      entree = checklist.appartements.find((a) => a.appartementId === appartement.id);
      expect(entree?.categoriesManquantes.slice().sort()).toEqual(["crep_plomb", "erp"]);

      // ERP valide + un CREP non expiré cette fois : plus rien ne manque.
      await creerDocumentTest("appartement", appartement.id, "erp");
      await creerDocumentTest("appartement", appartement.id, "crep_plomb");

      checklist = await tableauDeBordService.getChecklistDocumentaire();
      expect(checklist.appartements.find((a) => a.appartementId === appartement.id)).toBeUndefined();
    });

    it("appartement archivé : jamais signalé, même sans aucun diagnostic", async () => {
      const appartement = await appartementsService.create({
        bienId,
        numero: "53",
        type: "T2",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "700.00"
      });
      await appartementsService.archive(appartement.id);

      const checklist = await tableauDeBordService.getChecklistDocumentaire();
      expect(checklist.appartements.find((a) => a.appartementId === appartement.id)).toBeUndefined();
    });

    it("locataires : actif sans pièce apparaît, retiré du bail ou bail non actif n'apparaissent jamais", async () => {
      const appartementActif = await appartementsService.create({
        bienId,
        numero: "54",
        type: "T2",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "700.00"
      });
      const bailActif = await bauxService.create({
        appartementId: appartementActif.id,
        typeBail: "vide",
        dateDebut: "2026-01-01",
        loyerMensuel: "700.00",
        jourEcheance: 5
      });
      await bauxService.activer(bailActif.id);

      const appartementBrouillon = await appartementsService.create({
        bienId,
        numero: "55",
        type: "T2",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "700.00"
      });
      const bailBrouillon = await bauxService.create({
        appartementId: appartementBrouillon.id,
        typeBail: "vide",
        dateDebut: "2026-01-01",
        loyerMensuel: "700.00",
        jourEcheance: 5
      });

      const locataireActifSansPiece = await locatairesService.create(userId, { nom: "Un", prenom: "Test" });
      await bailLocatairesService.create({
        bailId: bailActif.id,
        locataireId: locataireActifSansPiece.id,
        role: "titulaire"
      });

      const locataireRetireDuBail = await locatairesService.create(userId, { nom: "Deux", prenom: "Test" });
      const liaisonRetiree = await bailLocatairesService.create({
        bailId: bailActif.id,
        locataireId: locataireRetireDuBail.id,
        role: "colocataire"
      });
      await bailLocatairesService.archive(liaisonRetiree.id);

      const locataireBailNonActif = await locatairesService.create(userId, { nom: "Trois", prenom: "Test" });
      await bailLocatairesService.create({
        bailId: bailBrouillon.id,
        locataireId: locataireBailNonActif.id,
        role: "titulaire"
      });

      const checklist = await tableauDeBordService.getChecklistDocumentaire();
      expect(checklist.locataires.some((l) => l.locataireId === locataireActifSansPiece.id)).toBe(true);
      expect(checklist.locataires.some((l) => l.locataireId === locataireRetireDuBail.id)).toBe(false);
      expect(checklist.locataires.some((l) => l.locataireId === locataireBailNonActif.id)).toBe(false);

      await creerDocumentTest("locataire", locataireActifSansPiece.id, "piece_identite");
      const apresUpload = await tableauDeBordService.getChecklistDocumentaire();
      expect(apresUpload.locataires.some((l) => l.locataireId === locataireActifSansPiece.id)).toBe(false);
    });

    it("garants : actif sans pièce apparaît, garant archivé ou bail non actif n'apparaissent jamais", async () => {
      const appartementActif = await appartementsService.create({
        bienId,
        numero: "56",
        type: "T2",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "700.00"
      });
      const bailActif = await bauxService.create({
        appartementId: appartementActif.id,
        typeBail: "vide",
        dateDebut: "2026-01-01",
        loyerMensuel: "700.00",
        jourEcheance: 5
      });
      await bauxService.activer(bailActif.id);

      const appartementBrouillon = await appartementsService.create({
        bienId,
        numero: "57",
        type: "T2",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "700.00"
      });
      const bailBrouillon = await bauxService.create({
        appartementId: appartementBrouillon.id,
        typeBail: "vide",
        dateDebut: "2026-01-01",
        loyerMensuel: "700.00",
        jourEcheance: 5
      });

      const garantActifSansPiece = await garantsService.create({
        bailId: bailActif.id,
        nom: "Un",
        prenom: "Garant",
        typeGarantie: "personne_physique"
      });
      const garantArchive = await garantsService.create({
        bailId: bailActif.id,
        nom: "Deux",
        prenom: "Garant",
        typeGarantie: "personne_physique"
      });
      await garantsService.archive(garantArchive.id);
      const garantBailNonActif = await garantsService.create({
        bailId: bailBrouillon.id,
        nom: "Trois",
        prenom: "Garant",
        typeGarantie: "personne_physique"
      });

      const checklist = await tableauDeBordService.getChecklistDocumentaire();
      expect(checklist.garants.some((g) => g.garantId === garantActifSansPiece.id)).toBe(true);
      expect(checklist.garants.some((g) => g.garantId === garantArchive.id)).toBe(false);
      expect(checklist.garants.some((g) => g.garantId === garantBailNonActif.id)).toBe(false);

      await creerDocumentTest("garant", garantActifSansPiece.id, "piece_identite");
      const apresUpload = await tableauDeBordService.getChecklistDocumentaire();
      expect(apresUpload.garants.some((g) => g.garantId === garantActifSansPiece.id)).toBe(false);
    });
  });

  describe("getCompletudeDocumentaire", () => {
    it("appartement : renvoie les 4 catégories, present via l'appartement OU l'immeuble parent, sinon document null", async () => {
      const appartement = await appartementsService.create({
        bienId,
        numero: "60",
        type: "T2",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "700.00"
      });

      let completude = await tableauDeBordService.getCompletudeDocumentaire("appartement", appartement.id);
      expect(completude.map((c) => c.categorie).sort()).toEqual(["crep_plomb", "dpe", "elec_gaz", "erp"]);
      expect(completude.every((c) => c.document === null)).toBe(true);

      await creerDocumentTest("appartement", appartement.id, "dpe");
      await creerDocumentTest("bien", bienId, "elec_gaz");

      completude = await tableauDeBordService.getCompletudeDocumentaire("appartement", appartement.id);
      const dpe = completude.find((c) => c.categorie === "dpe");
      const elecGaz = completude.find((c) => c.categorie === "elec_gaz");
      const erp = completude.find((c) => c.categorie === "erp");
      expect(dpe?.document?.nomFichier).toBe("test.pdf");
      expect(elecGaz?.document).not.toBeNull();
      expect(erp?.document).toBeNull();
    });

    it("appartement inconnu : rejette explicitement", async () => {
      await expect(
        tableauDeBordService.getCompletudeDocumentaire("appartement", randomUUID())
      ).rejects.toThrow();
    });

    it("locataire : une seule catégorie (pièce d'identité), present ou manquant", async () => {
      const locataire = await locatairesService.create(userId, { nom: "Complétude", prenom: "Test" });

      let completude = await tableauDeBordService.getCompletudeDocumentaire("locataire", locataire.id);
      expect(completude).toEqual([{ categorie: "piece_identite", document: null }]);

      await creerDocumentTest("locataire", locataire.id, "piece_identite");
      completude = await tableauDeBordService.getCompletudeDocumentaire("locataire", locataire.id);
      expect(completude[0]?.document).not.toBeNull();
    });

    it("garant : une seule catégorie (pièce d'identité), present ou manquant", async () => {
      const appartement = await appartementsService.create({
        bienId,
        numero: "61",
        type: "T2",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "700.00"
      });
      const bail = await bauxService.create({
        appartementId: appartement.id,
        typeBail: "vide",
        dateDebut: "2026-01-01",
        loyerMensuel: "700.00",
        jourEcheance: 5
      });
      const garant = await garantsService.create({
        bailId: bail.id,
        nom: "Complétude",
        prenom: "Garant",
        typeGarantie: "personne_physique"
      });

      let completude = await tableauDeBordService.getCompletudeDocumentaire("garant", garant.id);
      expect(completude).toEqual([{ categorie: "piece_identite", document: null }]);

      await creerDocumentTest("garant", garant.id, "piece_identite");
      completude = await tableauDeBordService.getCompletudeDocumentaire("garant", garant.id);
      expect(completude[0]?.document).not.toBeNull();
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
