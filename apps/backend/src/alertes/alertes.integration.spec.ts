import { randomUUID } from "crypto";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  documents,
  equipements,
  organisations,
  paiements,
  sinistre,
  utilisateurs,
  type Database
} from "db";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { BauxModule } from "../baux/baux.module";
import { BauxService } from "../baux/baux.service";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { DocumentsModule } from "../documents/documents.module";
import { EquipementsModule } from "../equipements/equipements.module";
import { PaiementsModule } from "../paiements/paiements.module";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { VersementsModule } from "../versements/versements.module";
import { VersementsService } from "../versements/versements.service";
import { AlertesConfigService } from "./alertes-config.service";
import { AlertesJobService } from "./alertes-job.service";
import { AlertesModule } from "./alertes.module";
import { AlertesService } from "./alertes.service";

// Vérifie le critère de complétion du Module 6 (docs/backlog.md) : le job
// exécuté deux fois de suite ne duplique jamais une alerte, ET le scénario
// découvreur (bail actif depuis plusieurs mois, aucun rattrapage
// automatique) est explicitement couvert.
describe("Alertes — job récurrent, idempotence, 5 types d'alertes (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let versementsService: VersementsService;
  let alertesJobService: AlertesJobService;
  let alertesService: AlertesService;
  let alertesConfigService: AlertesConfigService;
  let db: Database;
  let appartementId: string;

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
        DocumentsModule,
        EquipementsModule,
        AlertesModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    bauxService = moduleRef.get(BauxService);
    versementsService = moduleRef.get(VersementsService);
    alertesJobService = moduleRef.get(AlertesJobService);
    alertesService = moduleRef.get(AlertesService);
    alertesConfigService = moduleRef.get(AlertesConfigService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Alertes Intégration" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `alertes-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Alertes",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }

    const sci = await scisService.create(user.id, { nom: "SCI Alertes Test", regimeFiscal: "IR", adresse: "1 rue de Test", codePostal: "75001", ville: "Paris" });
    const bien = await bienService.create(user.id, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Alertes Test",
      adresse: "1 rue des Alertes",
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
    appartementId = appartement.id;
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  describe("génération récurrente des échéances", () => {
    it("scénario découvreur : bail actif depuis plusieurs mois, seul le mois courant reçoit une échéance au premier passage du job", async () => {
      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-03-15",
        loyerMensuel: "800.00",
        jourEcheance: 5
      });
      await bauxService.activer(bail.id); // génère l'échéance de mars (entrée)

      // Premier passage du job, simulé le 20 juillet (jourEcheance=5 déjà
      // dépassé ce mois-ci) : avril/mai/juin ne doivent jamais être générés,
      // juillet doit l'être quand même (pas d'attente du prochain mois).
      await alertesJobService.genererEcheancesRecurrentes("2026-07-20");

      const toutes = await db.select().from(paiements).where(eq(paiements.bailId, bail.id));
      const parMois = new Map(toutes.map((p) => [p.dateEcheance.slice(0, 7), p]));

      expect(parMois.has("2026-04")).toBe(false);
      expect(parMois.has("2026-05")).toBe(false);
      expect(parMois.has("2026-06")).toBe(false);
      expect(parMois.get("2026-03")?.montant).toBe("438.70"); // prorata entrée (17/31 jours), déjà couvert par activer()
      const echeanceJuillet = parMois.get("2026-07");
      expect(echeanceJuillet).toBeDefined();
      expect(echeanceJuillet?.montant).toBe("800.00");
      expect(echeanceJuillet?.dateEcheance).toBe("2026-07-05");
      expect(echeanceJuillet?.statut).toBe("impaye");
      expect(toutes).toHaveLength(2); // mars (entrée) + juillet, rien d'autre
    });

    it("est idempotent : exécuté deux fois de suite sur les mêmes données, ne crée pas de deuxième échéance pour le mois courant", async () => {
      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-06-01",
        loyerMensuel: "800.00",
        jourEcheance: 5
      });
      await bauxService.activer(bail.id);

      await alertesJobService.genererEcheancesRecurrentes("2026-07-10");
      await alertesJobService.genererEcheancesRecurrentes("2026-07-10");
      await alertesJobService.genererEcheancesRecurrentes("2026-07-25");

      const toutes = await db.select().from(paiements).where(eq(paiements.bailId, bail.id));
      const juillet = toutes.filter((p) => p.dateEcheance.startsWith("2026-07"));
      expect(juillet).toHaveLength(1);
    });

    it("fige loyerHorsCharges/charges au moment de la génération, jamais recalculés après révision du bail (Module Tâches, Étape 4)", async () => {
      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-06-01",
        loyerMensuel: "700.00",
        provisionsCharges: "100.00",
        jourEcheance: 5
      });
      await bauxService.activer(bail.id);

      await alertesJobService.genererEcheancesRecurrentes("2026-07-10");

      const [echeanceJuillet] = await db
        .select()
        .from(paiements)
        .where(and(eq(paiements.bailId, bail.id), eq(paiements.dateEcheance, "2026-07-05")));
      expect(echeanceJuillet?.loyerHorsCharges).toBe("700.00");
      expect(echeanceJuillet?.charges).toBe("100.00");
      expect(echeanceJuillet?.montant).toBe("800.00");

      // Le bail est révisé après coup — l'échéance déjà générée ne doit
      // jamais refléter la nouvelle valeur (décision produit explicite,
      // docs/data-dictionary.md, section paiements).
      await bauxService.update(bail.id, { loyerMensuel: "900.00" });
      const [echeanceApresRevision] = await db
        .select()
        .from(paiements)
        .where(and(eq(paiements.bailId, bail.id), eq(paiements.dateEcheance, "2026-07-05")));
      expect(echeanceApresRevision?.loyerHorsCharges).toBe("700.00");
    });

    it("charges vaut '0.00' (jamais NULL) quand le bail n'a pas de provisions pour charges", async () => {
      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-06-01",
        loyerMensuel: "700.00",
        jourEcheance: 5
      });
      await bauxService.activer(bail.id);

      await alertesJobService.genererEcheancesRecurrentes("2026-07-10");

      const [echeanceJuillet] = await db
        .select()
        .from(paiements)
        .where(and(eq(paiements.bailId, bail.id), eq(paiements.dateEcheance, "2026-07-05")));
      expect(echeanceJuillet?.loyerHorsCharges).toBe("700.00");
      expect(echeanceJuillet?.charges).toBe("0.00");
    });

    it("ne génère rien pour un bail résilié", async () => {
      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-03-01",
        loyerMensuel: "800.00",
        jourEcheance: 5
      });
      await bauxService.activer(bail.id);
      await bauxService.resilier(bail.id, { dateFin: "2026-05-31" });

      await alertesJobService.genererEcheancesRecurrentes("2026-07-20");

      const toutes = await db.select().from(paiements).where(eq(paiements.bailId, bail.id));
      expect(toutes.some((p) => p.dateEcheance.startsWith("2026-07"))).toBe(false);
    });
  });

  describe("génération des 6 types d'alertes", () => {
    it("bail_fin_proche : se déclenche dans la fenêtre de seuil, jamais dupliquée", async () => {
      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-01-01",
        loyerMensuel: "800.00",
        jourEcheance: 5,
        dateFin: "2026-07-20"
      });
      await bauxService.activer(bail.id);

      await alertesJobService.genererAlertes("2026-07-01");
      await alertesJobService.genererAlertes("2026-07-01");

      const alertes = await alertesService.findAll({ type: "bail_fin_proche" });
      const pourCeBail = alertes.filter((a) => a.entiteId === bail.id);
      expect(pourCeBail).toHaveLength(1);
      expect(pourCeBail[0]?.statut).toBe("active");
    });

    it("document_expire et document_expire_proche : jamais les deux en même temps pour le même document", async () => {
      const [documentExpire] = await db
        .insert(documents)
        .values({
          entiteType: "appartement",
          entiteId: appartementId,
          categorie: "diagnostic",
          dateExpiration: "2026-06-01",
          nomFichier: "diagnostic-expire.pdf",
          mimeType: "application/pdf",
          tailleOctets: 100,
          cheminStockage: "x"
        })
        .returning();
      const [documentProche] = await db
        .insert(documents)
        .values({
          entiteType: "appartement",
          entiteId: appartementId,
          categorie: "dpe",
          dateExpiration: "2026-07-20",
          nomFichier: "dpe-proche.pdf",
          mimeType: "application/pdf",
          tailleOctets: 100,
          cheminStockage: "x"
        })
        .returning();
      if (!documentExpire || !documentProche) {
        throw new Error("Échec de l'insertion des documents de test");
      }

      await alertesJobService.genererAlertes("2026-07-01");

      const alertesExpire = await alertesService.findAll({ type: "document_expire" });
      const alertesProche = await alertesService.findAll({ type: "document_expire_proche" });
      expect(alertesExpire.some((a) => a.entiteId === documentExpire.id)).toBe(true);
      expect(alertesProche.some((a) => a.entiteId === documentExpire.id)).toBe(false);
      expect(alertesProche.some((a) => a.entiteId === documentProche.id)).toBe(true);
      expect(alertesExpire.some((a) => a.entiteId === documentProche.id)).toBe(false);
    });

    it("entretien_equipement : ne se déclenche jamais sans intervalle renseigné", async () => {
      const [sansIntervalle] = await db
        .insert(equipements)
        .values({ appartementId, type: "chaudiere", dateDernierEntretien: "2025-01-01" })
        .returning();
      const [avecIntervalle] = await db
        .insert(equipements)
        .values({
          appartementId,
          type: "ballon_eau_chaude",
          dateDernierEntretien: "2025-06-01",
          intervalleEntretienMois: 12
        })
        .returning();
      if (!sansIntervalle || !avecIntervalle) {
        throw new Error("Échec de l'insertion des équipements de test");
      }

      await alertesJobService.genererAlertes("2026-07-01");

      const alertesEntretien = await alertesService.findAll({ type: "entretien_equipement" });
      expect(alertesEntretien.some((a) => a.entiteId === sansIntervalle.id)).toBe(false);
      expect(alertesEntretien.some((a) => a.entiteId === avecIntervalle.id)).toBe(true);
    });

    it("impaye : respecte le délai de grâce configuré, jamais dupliquée", async () => {
      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-01-01",
        loyerMensuel: "800.00",
        jourEcheance: 5
      });
      await bauxService.activer(bail.id);
      const [paiementEnRetard] = await db
        .insert(paiements)
        .values({ bailId: bail.id, type: "loyer", montant: "800.00", dateEcheance: "2026-06-05" })
        .returning();
      if (!paiementEnRetard) {
        throw new Error("Échec de l'insertion du paiement de test");
      }

      const seuilGrace = await alertesConfigService.getSeuil("impaye");
      expect(seuilGrace).toBe(5);

      // 2026-06-05 + 5 jours = 2026-06-10, encore toléré ce jour-là.
      await alertesJobService.genererAlertes("2026-06-10");
      let alertesImpaye = await alertesService.findAll({ type: "impaye" });
      expect(alertesImpaye.some((a) => a.entiteId === paiementEnRetard.id)).toBe(false);

      await alertesJobService.genererAlertes("2026-06-11");
      await alertesJobService.genererAlertes("2026-06-11");
      alertesImpaye = await alertesService.findAll({ type: "impaye" });
      const pourCePaiement = alertesImpaye.filter((a) => a.entiteId === paiementEnRetard.id);
      expect(pourCePaiement).toHaveLength(1);
    });

    it("impaye : scénario bout-en-bout impaye -> payé -> impaye à nouveau (annulation du versement), sans alerte fantôme ni doublon", async () => {
      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-01-01",
        loyerMensuel: "800.00",
        jourEcheance: 5
      });
      await bauxService.activer(bail.id);
      // L'échéance d'entrée générée par activer() n'est pas l'objet de ce
      // test (elle serait, elle aussi, en retard et génèrerait sa propre
      // alerte impaye) — on l'archive pour isoler le scénario.
      for (const echeanceEntree of await db.select().from(paiements).where(eq(paiements.bailId, bail.id))) {
        await db.update(paiements).set({ archivedAt: new Date() }).where(eq(paiements.id, echeanceEntree.id));
      }
      const [paiement] = await db
        .insert(paiements)
        .values({ bailId: bail.id, type: "loyer", montant: "800.00", dateEcheance: "2026-06-05" })
        .returning();
      if (!paiement) {
        throw new Error("Échec de l'insertion du paiement de test");
      }

      // Retard au-delà du délai de grâce (5 jours) : l'alerte s'ouvre.
      await alertesJobService.genererAlertes("2026-06-11");
      const alerteOuverte = (await alertesService.findAll({ type: "impaye" })).find(
        (a) => a.entiteId === paiement.id
      );
      expect(alerteOuverte?.statut).toBe("active");

      // Le paiement est réglé : le job suivant doit refermer l'alerte,
      // jamais la laisser active indéfiniment (le bug "fantôme" signalé
      // par financial-logic-reviewer).
      const versement = await versementsService.ajouter({
        paiementId: paiement.id,
        montant: "800.00",
        mode: "virement",
        dateVersement: "2026-06-12"
      });
      await alertesJobService.genererAlertes("2026-06-12");
      const fermee = (await alertesService.findAll({ type: "impaye" })).find((a) => a.entiteId === paiement.id);
      expect(fermee?.id).toBe(alerteOuverte?.id);
      expect(fermee?.statut).toBe("resolue");

      // Rapprochement erroné détecté après coup : le paiement redevient
      // impaye en annulant CE versement précis (VersementsService.annuler()).
      await versementsService.annuler(versement.id);
      await alertesJobService.genererAlertes("2026-06-20");

      const toutes = (await alertesService.findAll({ type: "impaye" })).filter((a) => a.entiteId === paiement.id);
      // Réouverture EN PLACE de la même ligne, jamais une nouvelle : le
      // paiement n'a jamais été traite/ignoree par un humain entre-temps.
      expect(toutes).toHaveLength(1);
      expect(toutes[0]?.id).toBe(alerteOuverte?.id);
      expect(toutes[0]?.statut).toBe("active");
    });

    it("traiter() n'est jamais annulé par une nouvelle exécution du job", async () => {
      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-01-01",
        loyerMensuel: "800.00",
        jourEcheance: 5,
        dateFin: "2026-07-20"
      });
      await bauxService.activer(bail.id);

      await alertesJobService.genererAlertes("2026-07-01");
      const [alerte] = await alertesService.findAll({ type: "bail_fin_proche" });
      if (!alerte) {
        throw new Error("Alerte bail_fin_proche attendue introuvable");
      }
      await alertesService.traiter(alerte.id);

      await alertesJobService.genererAlertes("2026-07-05");

      const apres = await alertesService.findAll({ type: "bail_fin_proche" });
      const memesAlerte = apres.filter((a) => a.entiteId === bail.id);
      expect(memesAlerte).toHaveLength(1);
      expect(memesAlerte[0]?.statut).toBe("traitee");
    });

    it("findAll() et traiter() ne renvoient jamais derniere_condition_vraie (champ interne au job)", async () => {
      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-01-01",
        loyerMensuel: "800.00",
        jourEcheance: 5,
        dateFin: "2026-07-20"
      });
      await bauxService.activer(bail.id);

      await alertesJobService.genererAlertes("2026-07-01");
      const [alerte] = await alertesService.findAll({ type: "bail_fin_proche" });
      if (!alerte) {
        throw new Error("Alerte bail_fin_proche attendue introuvable");
      }
      expect(alerte).not.toHaveProperty("derniereConditionVraie");

      const traitee = await alertesService.traiter(alerte.id);
      expect(traitee).not.toHaveProperty("derniereConditionVraie");
    });

    it("traitee : une nouvelle occurrence (condition passée par faux puis revenue vraie) crée une nouvelle alerte, sans jamais réécrire l'ancienne", async () => {
      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-01-01",
        loyerMensuel: "800.00",
        jourEcheance: 5,
        dateFin: "2026-07-20"
      });
      await bauxService.activer(bail.id);

      await alertesJobService.genererAlertes("2026-07-01");
      const [alerteInitiale] = await alertesService.findAll({ type: "bail_fin_proche" });
      if (!alerteInitiale) {
        throw new Error("Alerte bail_fin_proche attendue introuvable");
      }
      await alertesService.traiter(alerteInitiale.id);

      // Repousse la fin du bail hors de la fenêtre de seuil : le job doit
      // observer la condition passer à faux (même si le statut traitee ne
      // bouge jamais).
      await bauxService.update(bail.id, { dateFin: "2027-06-01" });
      await alertesJobService.genererAlertes("2026-07-05");

      // La fin du bail se rapproche à nouveau : vraie nouvelle occurrence.
      await bauxService.update(bail.id, { dateFin: "2026-07-25" });
      await alertesJobService.genererAlertes("2026-07-10");

      const toutes = await alertesService.findAll({ type: "bail_fin_proche" });
      const pourCeBail = toutes.filter((a) => a.entiteId === bail.id);
      expect(pourCeBail).toHaveLength(2);
      expect(pourCeBail.find((a) => a.id === alerteInitiale.id)?.statut).toBe("traitee");
      const nouvelleOccurrence = pourCeBail.find((a) => a.id !== alerteInitiale.id);
      expect(nouvelleOccurrence?.statut).toBe("active");
    });

    it("resolue : se rouvre EN PLACE (même ligne) quand la condition redevient vraie, jamais une nouvelle ligne", async () => {
      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-01-01",
        loyerMensuel: "800.00",
        jourEcheance: 5,
        dateFin: "2026-07-20"
      });
      await bauxService.activer(bail.id);

      await alertesJobService.genererAlertes("2026-07-01");
      const [alerteInitiale] = await alertesService.findAll({ type: "bail_fin_proche" });
      if (!alerteInitiale) {
        throw new Error("Alerte bail_fin_proche attendue introuvable");
      }

      // Fermeture automatique : jamais traitee par un humain ici.
      await bauxService.update(bail.id, { dateFin: "2027-06-01" });
      await alertesJobService.genererAlertes("2026-07-05");
      const [fermee] = await alertesService.findAll({ type: "bail_fin_proche" });
      expect(fermee?.id).toBe(alerteInitiale.id);
      expect(fermee?.statut).toBe("resolue");

      // La fin du bail redevient proche : réouverture EN PLACE attendue.
      await bauxService.update(bail.id, { dateFin: "2026-07-25" });
      await alertesJobService.genererAlertes("2026-07-10");

      const toutes = await alertesService.findAll({ type: "bail_fin_proche" });
      const pourCeBail = toutes.filter((a) => a.entiteId === bail.id);
      expect(pourCeBail).toHaveLength(1);
      expect(pourCeBail[0]?.id).toBe(alerteInitiale.id);
      expect(pourCeBail[0]?.statut).toBe("active");
    });
  });

  // Module Suivi sinistre et assurance (2026-09-16) : délai FIXE et
  // IDENTIQUE quel que soit le statut du sinistre (décision actée avec
  // Jimmy) — voir calculerAlerteSinistreStagnation (packages/core),
  // directement générique de calculerAlerteEntretienEquipement. Tous les
  // sinistres (y compris archivés) : un sinistre archivé referme
  // naturellement une alerte encore active, même principe que les 4 autres
  // générateurs ci-dessus.
  describe("sinistre_stagnation", () => {
    it("se déclenche seuil jours après dateChangementStatut, jamais avant, jamais dupliquée", async () => {
      const seuil = await alertesConfigService.getSeuil("sinistre_stagnation");
      expect(seuil).toBe(15);

      const [organisation] = await db
        .insert(organisations)
        .values({ type: "particulier", nom: "Organisation Sinistre Stagnation Test" })
        .returning();
      if (!organisation) throw new Error("Échec de l'insertion de l'organisation de test");
      const [sinistreLigne] = await db
        .insert(sinistre)
        .values({
          type: "degat_eaux",
          dateDeclaration: "2026-06-01",
          dateChangementStatut: new Date("2026-06-01T00:00:00Z"),
          organisationId: organisation.id
        })
        .returning();
      if (!sinistreLigne) throw new Error("Échec de l'insertion du sinistre de test");

      // Encore dans le délai (14 jours) : pas d'alerte.
      await alertesJobService.genererAlertes("2026-06-15");
      let alertesSinistre = await alertesService.findAll({ type: "sinistre_stagnation" });
      expect(alertesSinistre.some((a) => a.entiteId === sinistreLigne.id)).toBe(false);

      // Seuil atteint (15 jours) : l'alerte s'ouvre, jamais dupliquée sur
      // un second passage le même jour.
      await alertesJobService.genererAlertes("2026-06-16");
      await alertesJobService.genererAlertes("2026-06-16");
      alertesSinistre = await alertesService.findAll({ type: "sinistre_stagnation" });
      const pourCeSinistre = alertesSinistre.filter((a) => a.entiteId === sinistreLigne.id);
      expect(pourCeSinistre).toHaveLength(1);
      expect(pourCeSinistre[0]?.statut).toBe("active");
    });

    it("statut 'clos' : jamais de condition vraie, quel que soit le temps écoulé", async () => {
      const [organisation] = await db
        .insert(organisations)
        .values({ type: "particulier", nom: "Organisation Sinistre Clos Test" })
        .returning();
      if (!organisation) throw new Error("Échec de l'insertion de l'organisation de test");
      const [sinistreLigne] = await db
        .insert(sinistre)
        .values({
          type: "incendie",
          statut: "clos",
          dateDeclaration: "2026-01-01",
          dateChangementStatut: new Date("2026-01-01T00:00:00Z"),
          organisationId: organisation.id
        })
        .returning();
      if (!sinistreLigne) throw new Error("Échec de l'insertion du sinistre de test");

      await alertesJobService.genererAlertes("2026-09-01"); // largement au-delà du seuil

      const alertesSinistre = await alertesService.findAll({ type: "sinistre_stagnation" });
      expect(alertesSinistre.some((a) => a.entiteId === sinistreLigne.id)).toBe(false);
    });

    it("un sinistre archivé referme une alerte déjà active", async () => {
      const [organisation] = await db
        .insert(organisations)
        .values({ type: "particulier", nom: "Organisation Sinistre Archive Test" })
        .returning();
      if (!organisation) throw new Error("Échec de l'insertion de l'organisation de test");
      const [sinistreLigne] = await db
        .insert(sinistre)
        .values({
          type: "vol",
          dateDeclaration: "2026-06-01",
          dateChangementStatut: new Date("2026-06-01T00:00:00Z"),
          organisationId: organisation.id
        })
        .returning();
      if (!sinistreLigne) throw new Error("Échec de l'insertion du sinistre de test");

      await alertesJobService.genererAlertes("2026-06-20");
      const [alerteOuverte] = await alertesService.findAll({ type: "sinistre_stagnation" });
      expect(alerteOuverte?.statut).toBe("active");

      await db.update(sinistre).set({ archivedAt: new Date() }).where(eq(sinistre.id, sinistreLigne.id));
      await alertesJobService.genererAlertes("2026-06-21");

      const [fermee] = await alertesService.findAll({ type: "sinistre_stagnation" });
      expect(fermee?.id).toBe(alerteOuverte?.id);
      expect(fermee?.statut).toBe("resolue");
    });

    it("un changement réel de statut (dateChangementStatut avancée) referme puis peut rouvrir l'alerte", async () => {
      const [organisation] = await db
        .insert(organisations)
        .values({ type: "particulier", nom: "Organisation Sinistre Changement Statut Test" })
        .returning();
      if (!organisation) throw new Error("Échec de l'insertion de l'organisation de test");
      const [sinistreLigne] = await db
        .insert(sinistre)
        .values({
          type: "bris_de_glace",
          dateDeclaration: "2026-06-01",
          dateChangementStatut: new Date("2026-06-01T00:00:00Z"),
          organisationId: organisation.id
        })
        .returning();
      if (!sinistreLigne) throw new Error("Échec de l'insertion du sinistre de test");

      await alertesJobService.genererAlertes("2026-06-20");
      const [alerteOuverte] = await alertesService.findAll({ type: "sinistre_stagnation" });
      expect(alerteOuverte?.statut).toBe("active");

      // Le dossier avance réellement (expertise planifiée) : le compteur
      // de stagnation repart de zéro.
      await db
        .update(sinistre)
        .set({ statut: "expertise_planifiee", dateChangementStatut: new Date("2026-06-20T00:00:00Z") })
        .where(eq(sinistre.id, sinistreLigne.id));
      await alertesJobService.genererAlertes("2026-06-21");
      const [fermee] = await alertesService.findAll({ type: "sinistre_stagnation" });
      expect(fermee?.id).toBe(alerteOuverte?.id);
      expect(fermee?.statut).toBe("resolue");

      // La stagnation reprend depuis la nouvelle date : réouverture EN
      // PLACE de la même ligne (même principe que bail_fin_proche).
      await alertesJobService.genererAlertes("2026-07-06");
      const [rouverte] = await alertesService.findAll({ type: "sinistre_stagnation" });
      expect(rouverte?.id).toBe(alerteOuverte?.id);
      expect(rouverte?.statut).toBe("active");
    });
  });

  describe("parametres_alertes", () => {
    it("crée les 5 types configurables avec leurs valeurs par défaut au premier accès", async () => {
      const tous = await alertesConfigService.findAll();
      const parType = new Map(tous.map((p) => [p.type, p.seuilJoursAvant]));
      expect(parType.get("bail_fin_proche")).toBe(30);
      expect(parType.get("document_expire_proche")).toBe(30);
      expect(parType.get("entretien_equipement")).toBe(30);
      expect(parType.get("impaye")).toBe(5);
      expect(parType.get("sinistre_stagnation")).toBe(15);
      expect(parType.has("document_expire")).toBe(false);
    });
  });
});
