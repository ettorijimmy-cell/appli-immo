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
  utilisateurs,
  type Database
} from "db";
import { eq } from "drizzle-orm";
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
import { DocumentsModule } from "../documents/documents.module";
import { EquipementsModule } from "../equipements/equipements.module";
import { ImmeublesModule } from "../immeubles/immeubles.module";
import { ImmeublesService } from "../immeubles/immeubles.service";
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
  let immeublesService: ImmeublesService;
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
        ImmeublesModule,
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
    immeublesService = moduleRef.get(ImmeublesService);
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
    const immeuble = await immeublesService.create({
      sciId: sci.id,
      nom: "Immeuble Alertes Test",
      adresse: "1 rue des Alertes",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartement = await appartementsService.create({
      immeubleId: immeuble.id,
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
    await moduleRef.close();
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

  describe("génération des 5 types d'alertes", () => {
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

  describe("parametres_alertes", () => {
    it("crée les 4 types configurables avec leurs valeurs par défaut au premier accès", async () => {
      const tous = await alertesConfigService.findAll();
      const parType = new Map(tous.map((p) => [p.type, p.seuilJoursAvant]));
      expect(parType.get("bail_fin_proche")).toBe(30);
      expect(parType.get("document_expire_proche")).toBe(30);
      expect(parType.get("entretien_equipement")).toBe(30);
      expect(parType.get("impaye")).toBe(5);
      expect(parType.has("document_expire")).toBe(false);
    });
  });
});
