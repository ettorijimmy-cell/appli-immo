import { randomUUID } from "crypto";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  bailLocataires,
  baux,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  documents,
  equipements,
  indicesIrl,
  locataires,
  organisations,
  paiements,
  revisionLoyer,
  tache,
  utilisateurs,
  type Database
} from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AlertesJobService } from "../alertes/alertes-job.service";
import { AlertesModule } from "../alertes/alertes.module";
import { AlertesService } from "../alertes/alertes.service";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { BauxModule } from "../baux/baux.module";
import { BauxService } from "../baux/baux.service";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { DocumentsModule } from "../documents/documents.module";
import { EquipementsModule } from "../equipements/equipements.module";
import { IndicesIrlModule } from "../indices-irl/indices-irl.module";
import { ModelesCourrierModule } from "../modeles-courrier/modeles-courrier.module";
import { ModelesCourrierService } from "../modeles-courrier/modeles-courrier.service";
import { PaiementsModule } from "../paiements/paiements.module";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { VersementsModule } from "../versements/versements.module";
import { VersementsService } from "../versements/versements.service";
import { TachesJobService } from "./taches-job.service";
import { TachesModule } from "./taches.module";
import { TachesService } from "./taches.service";

// Vérifie le périmètre exact du Module Tâches, Étape 1 (docs/backlog.md,
// docs/data-dictionary.md section tache) : dérivation depuis les 3 types
// d'alerte en périmètre, exclusion explicite de bail_fin_proche/
// document_expire_proche, exclusion de document_expire hors
// appartement/bail/bien, idempotence, et les actions marquerFait/
// marquerAnnulee.
describe("Tâches — génération depuis alertes, idempotence, actions (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let alertesJobService: AlertesJobService;
  let tachesJobService: TachesJobService;
  let tachesService: TachesService;
  let requestContextService: RequestContextService;
  let db: Database;
  let organisationId: string;
  let userId: string;
  let bienId: string;
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
        DocumentsModule,
        EquipementsModule,
        AlertesModule,
        TachesModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    bauxService = moduleRef.get(BauxService);
    alertesJobService = moduleRef.get(AlertesJobService);
    tachesJobService = moduleRef.get(TachesJobService);
    tachesService = moduleRef.get(TachesService);
    requestContextService = moduleRef.get(RequestContextService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Tâches Intégration" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    organisationId = organisation.id;
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `taches-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Tâches",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    userId = user.id;

    const sci = await scisService.create(user.id, {
      nom: "SCI Tâches Test",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(user.id, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Tâches Test",
      adresse: "1 rue des Tâches",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    bienId = bien.id;
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

  it("impaye : résout bailId et appartementId depuis l'alerte", async () => {
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
    if (!paiementEnRetard) throw new Error("Échec de l'insertion du paiement de test");

    await alertesJobService.genererAlertes("2026-06-11"); // au-delà du délai de grâce (5j)
    await tachesJobService.genererTachesDepuisAlertes();

    const taches = await tachesService.findAll({ type: "impaye" });
    const tache = taches.find((t) => t.bailId === bail.id);
    expect(tache).toBeDefined();
    expect(tache?.statut).toBe("a_faire");
    expect(tache?.origine).toBe("alerte");
    expect(tache?.appartementId).toBe(appartementId);
    expect(tache?.organisationId).toBe(organisationId);
    expect(tache?.bienId).toBeNull();
  });

  it("entretien_equipement : résout appartementId depuis l'alerte", async () => {
    const [equipement] = await db
      .insert(equipements)
      .values({
        appartementId,
        type: "chaudiere",
        dateDernierEntretien: "2025-01-01",
        intervalleEntretienMois: 12
      })
      .returning();
    if (!equipement) throw new Error("Échec de l'insertion de l'équipement de test");

    await alertesJobService.genererAlertes("2026-07-01");
    await tachesJobService.genererTachesDepuisAlertes();

    const taches = await tachesService.findAll({ type: "entretien_equipement" });
    const tache = taches.find((t) => t.appartementId === appartementId);
    expect(tache).toBeDefined();
    expect(tache?.bailId).toBeNull();
    expect(tache?.organisationId).toBe(organisationId);
  });

  it("document_expire attaché à un appartement : résout appartementId", async () => {
    const [document] = await db
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
    if (!document) throw new Error("Échec de l'insertion du document de test");

    await alertesJobService.genererAlertes("2026-07-01");
    await tachesJobService.genererTachesDepuisAlertes();

    const taches = await tachesService.findAll({ type: "document_expire" });
    const tache = taches.find((t) => t.appartementId === appartementId);
    expect(tache).toBeDefined();
    expect(tache?.bienId).toBeNull();
  });

  it("document_expire attaché à un bail : résout bailId et appartementId", async () => {
    const bail = await bauxService.create({
      appartementId,
      typeBail: "vide",
      dateDebut: "2026-01-01",
      loyerMensuel: "800.00",
      jourEcheance: 5
    });
    await bauxService.activer(bail.id);
    const [document] = await db
      .insert(documents)
      .values({
        entiteType: "bail",
        entiteId: bail.id,
        categorie: "assurance",
        dateExpiration: "2026-06-01",
        nomFichier: "assurance-expiree.pdf",
        mimeType: "application/pdf",
        tailleOctets: 100,
        cheminStockage: "x"
      })
      .returning();
    if (!document) throw new Error("Échec de l'insertion du document de test");

    await alertesJobService.genererAlertes("2026-07-01");
    await tachesJobService.genererTachesDepuisAlertes();

    const taches = await tachesService.findAll({ type: "document_expire" });
    const tache = taches.find((t) => t.bailId === bail.id);
    expect(tache).toBeDefined();
    expect(tache?.appartementId).toBe(appartementId);
  });

  it("document_expire attaché à un bien : résout bienId, laisse appartementId/bailId à null", async () => {
    const [document] = await db
      .insert(documents)
      .values({
        entiteType: "bien",
        entiteId: bienId,
        categorie: "assurance",
        dateExpiration: "2026-06-01",
        nomFichier: "assurance-bien-expiree.pdf",
        mimeType: "application/pdf",
        tailleOctets: 100,
        cheminStockage: "x"
      })
      .returning();
    if (!document) throw new Error("Échec de l'insertion du document de test");

    await alertesJobService.genererAlertes("2026-07-01");
    await tachesJobService.genererTachesDepuisAlertes();

    const taches = await tachesService.findAll({ type: "document_expire" });
    const tache = taches.find((t) => t.bienId === bienId);
    expect(tache).toBeDefined();
    expect(tache?.appartementId).toBeNull();
    expect(tache?.bailId).toBeNull();
  });

  it("document_expire attaché à un locataire : aucune tâche générée (hors périmètre de cette étape)", async () => {
    const [locataire] = await db.insert(locataires).values({ nom: "Dupont", prenom: "Jean" }).returning();
    if (!locataire) throw new Error("Échec de l'insertion du locataire de test");
    const [document] = await db
      .insert(documents)
      .values({
        entiteType: "locataire",
        entiteId: locataire.id,
        categorie: "piece_identite",
        dateExpiration: "2026-06-01",
        nomFichier: "cni-expiree.pdf",
        mimeType: "application/pdf",
        tailleOctets: 100,
        cheminStockage: "x"
      })
      .returning();
    if (!document) throw new Error("Échec de l'insertion du document de test");

    await alertesJobService.genererAlertes("2026-07-01");
    const nombreCreees = await tachesJobService.genererTachesDepuisAlertes();

    expect(nombreCreees).toBe(0);
    const taches = await tachesService.findAll({ type: "document_expire" });
    expect(taches.some((t) => t.alerteSourceId !== null)).toBe(false);
  });

  it("bail_fin_proche et document_expire_proche : jamais de tâche générée, même actives", async () => {
    const alertesService = moduleRef.get(AlertesService);

    const bail = await bauxService.create({
      appartementId,
      typeBail: "vide",
      dateDebut: "2026-01-01",
      loyerMensuel: "800.00",
      jourEcheance: 5,
      dateFin: "2026-07-20"
    });
    await bauxService.activer(bail.id);
    // Archive l'échéance d'entrée générée par activer() : sans cela, elle
    // serait aussi en retard au 2026-07-01 et déclencherait une alerte
    // impaye légitime, qui contaminerait ce test dont l'objet est
    // exclusivement bail_fin_proche/document_expire_proche.
    for (const echeance of await db.select().from(paiements).where(eq(paiements.bailId, bail.id))) {
      await db.update(paiements).set({ archivedAt: new Date() }).where(eq(paiements.id, echeance.id));
    }
    const [documentProche] = await db
      .insert(documents)
      .values({
        entiteType: "appartement",
        entiteId: appartementId,
        categorie: "dpe",
        dateExpiration: "2026-07-25",
        nomFichier: "dpe-proche.pdf",
        mimeType: "application/pdf",
        tailleOctets: 100,
        cheminStockage: "x"
      })
      .returning();
    if (!documentProche) throw new Error("Échec de l'insertion du document de test");

    await alertesJobService.genererAlertes("2026-07-01");
    const alerteBailFinProche = (await alertesService.findAll({ type: "bail_fin_proche" })).find(
      (a) => a.entiteId === bail.id
    );
    const alerteDocumentProche = (await alertesService.findAll({ type: "document_expire_proche" })).find(
      (a) => a.entiteId === documentProche.id
    );
    // Condition nécessaire au test : les deux alertes doivent bien être
    // actives, sinon l'absence de tâche ne prouverait rien.
    expect(alerteBailFinProche?.statut).toBe("active");
    expect(alerteDocumentProche?.statut).toBe("active");

    const nombreCreees = await tachesJobService.genererTachesDepuisAlertes();

    expect(nombreCreees).toBe(0);
    const toutesLesTaches = await tachesService.findAll({});
    expect(toutesLesTaches.some((t) => t.alerteSourceId === alerteBailFinProche?.id)).toBe(false);
    expect(toutesLesTaches.some((t) => t.alerteSourceId === alerteDocumentProche?.id)).toBe(false);
  });

  it("est idempotent : exécuté deux fois de suite, ne crée jamais de deuxième tâche active pour la même alerte", async () => {
    const [equipement] = await db
      .insert(equipements)
      .values({
        appartementId,
        type: "chaudiere",
        dateDernierEntretien: "2025-01-01",
        intervalleEntretienMois: 12
      })
      .returning();
    if (!equipement) throw new Error("Échec de l'insertion de l'équipement de test");

    await alertesJobService.genererAlertes("2026-07-01");
    await tachesJobService.genererTachesDepuisAlertes();
    const secondPassage = await tachesJobService.genererTachesDepuisAlertes();

    expect(secondPassage).toBe(0);
    const taches = await tachesService.findAll({ type: "entretien_equipement" });
    const pourCetEquipement = taches.filter((t) => t.appartementId === appartementId);
    expect(pourCetEquipement).toHaveLength(1);
  });

  it("marquerFait pose dateCompletion et passe statut à fait", async () => {
    const [equipement] = await db
      .insert(equipements)
      .values({
        appartementId,
        type: "chaudiere",
        dateDernierEntretien: "2025-01-01",
        intervalleEntretienMois: 12
      })
      .returning();
    if (!equipement) throw new Error("Échec de l'insertion de l'équipement de test");
    await alertesJobService.genererAlertes("2026-07-01");
    await tachesJobService.genererTachesDepuisAlertes();
    const [tacheCreee] = await tachesService.findAll({ type: "entretien_equipement" });
    if (!tacheCreee) throw new Error("Tâche entretien_equipement attendue introuvable");

    const misAJour = await tachesService.marquerFait(tacheCreee.id);

    expect(misAJour.statut).toBe("fait");
    expect(misAJour.dateCompletion).not.toBeNull();
  });

  it("marquerAnnulee passe statut à annulee et efface dateCompletion", async () => {
    const [equipement] = await db
      .insert(equipements)
      .values({
        appartementId,
        type: "chaudiere",
        dateDernierEntretien: "2025-01-01",
        intervalleEntretienMois: 12
      })
      .returning();
    if (!equipement) throw new Error("Échec de l'insertion de l'équipement de test");
    await alertesJobService.genererAlertes("2026-07-01");
    await tachesJobService.genererTachesDepuisAlertes();
    const [tacheCreee] = await tachesService.findAll({ type: "entretien_equipement" });
    if (!tacheCreee) throw new Error("Tâche entretien_equipement attendue introuvable");
    await tachesService.marquerFait(tacheCreee.id);

    const annulee = await tachesService.marquerAnnulee(tacheCreee.id);

    expect(annulee.statut).toBe("annulee");
    expect(annulee.dateCompletion).toBeNull();
  });

  it("une tâche marquée fait libère l'idempotence : le job insère une nouvelle ligne distincte, sans jamais rouvrir ni modifier l'ancienne (aucune state machine partagée avec alertes)", async () => {
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
    if (!paiementEnRetard) throw new Error("Échec de l'insertion du paiement de test");

    await alertesJobService.genererAlertes("2026-06-11");
    await tachesJobService.genererTachesDepuisAlertes();
    const [tacheInitiale] = await tachesService.findAll({ type: "impaye" });
    if (!tacheInitiale) throw new Error("Tâche impaye attendue introuvable");
    await tachesService.marquerFait(tacheInitiale.id);

    // La même alerte est toujours active (le job Alertes ne l'a jamais
    // refermée, le paiement n'a jamais été réglé) : le job Tâches doit
    // pouvoir créer une nouvelle tâche puisque l'ancienne n'est plus
    // a_faire/en_cours.
    const nombreCreees = await tachesJobService.genererTachesDepuisAlertes();

    expect(nombreCreees).toBe(1);
    const toutes = await tachesService.findAll({ type: "impaye" });
    const pourCePaiement = toutes.filter((t) => t.alerteSourceId === tacheInitiale.alerteSourceId);
    expect(pourCePaiement).toHaveLength(2);
    expect(pourCePaiement.find((t) => t.id === tacheInitiale.id)?.statut).toBe("fait");
    expect(pourCePaiement.find((t) => t.id !== tacheInitiale.id)?.statut).toBe("a_faire");
  });

  // Correctif scoping multi-tenant (2026-08-31) : findAll() doit filtrer
  // par l'organisation de l'utilisateur authentifié en contexte
  // (RequestContextService), pour ne jamais exposer les tâches d'une autre
  // organisation — trou de sécurité latent repéré pendant l'extension
  // notifications ci-dessous (voir docs/error-log.md).
  it("findAll() ne renvoie que les tâches de l'organisation de l'utilisateur authentifié en contexte", async () => {
    const [autreOrganisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Autre organisation Tâches Intégration" })
      .returning();
    if (!autreOrganisation) throw new Error("Échec de l'insertion de l'autre organisation de test");
    const [autreUser] = await db
      .insert(utilisateurs)
      .values({
        organisationId: autreOrganisation.id,
        email: `taches-integration-autre-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Autre",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!autreUser) throw new Error("Échec de l'insertion de l'autre utilisateur de test");

    const [tacheOrgA] = await db
      .insert(tache)
      .values({ type: "autre", origine: "manuelle", organisationId })
      .returning();
    const [tacheOrgB] = await db
      .insert(tache)
      .values({ type: "autre", origine: "manuelle", organisationId: autreOrganisation.id })
      .returning();
    if (!tacheOrgA || !tacheOrgB) throw new Error("Échec de l'insertion des tâches de test");

    const taches = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      tachesService.findAll({})
    );
    const tachesAutre = await requestContextService.executerAvecContexte({ utilisateurId: autreUser.id }, () =>
      tachesService.findAll({})
    );
    const tachesSansContexte = await tachesService.findAll({});

    expect(taches.some((t) => t.id === tacheOrgA.id)).toBe(true);
    expect(taches.some((t) => t.id === tacheOrgB.id)).toBe(false);
    expect(tachesAutre.some((t) => t.id === tacheOrgB.id)).toBe(true);
    expect(tachesAutre.some((t) => t.id === tacheOrgA.id)).toBe(false);
    // Hors contexte HTTP (aucun utilisateurId résolu, comme un script) :
    // aucune organisation à filtrer, comportement inchangé — voir
    // TachesService.findAll().
    expect(tachesSansContexte.some((t) => t.id === tacheOrgA.id)).toBe(true);
    expect(tachesSansContexte.some((t) => t.id === tacheOrgB.id)).toBe(true);
  });

  // Extension notifications (2026-08-31, docs/backlog.md) : résolution du
  // titulaire + construction de la notification à la génération de la
  // tâche, pour impaye/entretien_equipement/document_expire (appartement
  // et bail). Modèles seedés localement dans chaque test (hermétique,
  // indépendant du script de seed réel), textes simplifiés pour une
  // assertion exacte.
  describe("notifications résolues depuis les alertes", () => {
    it("impaye : titulaire résolu — notification générée avec les bonnes variables", async () => {
      const modelesCourrierService = moduleRef.get(ModelesCourrierService);
      await modelesCourrierService.upsertModeleCourrier({
        code: "impaye",
        nom: "Impayé (test)",
        canal: "email",
        objet: "Objet {{libelleBien}}",
        corps: "{{nomLocataire}} doit {{montant}} € ({{typePaiement}}) depuis le {{dateEcheance}}, bien {{libelleBien}}.",
        variablesRequises: ["nomLocataire", "libelleBien", "montant", "dateEcheance", "typePaiement"],
        organisationId
      });

      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-01-01",
        loyerMensuel: "800.00",
        jourEcheance: 5
      });
      await bauxService.activer(bail.id);
      // L'échéance d'entrée générée par activer() n'est pas l'objet de ce
      // test (elle génèrerait sa propre alerte impaye) — archivée pour
      // isoler le scénario, même principe qu'alertes.integration.spec.ts.
      for (const echeanceEntree of await db.select().from(paiements).where(eq(paiements.bailId, bail.id))) {
        await db.update(paiements).set({ archivedAt: new Date() }).where(eq(paiements.id, echeanceEntree.id));
      }
      const [locataire] = await db.insert(locataires).values({ nom: "Devos", prenom: "Ilan" }).returning();
      if (!locataire) throw new Error("Échec de l'insertion du locataire de test");
      await db.insert(bailLocataires).values({ bailId: bail.id, locataireId: locataire.id, role: "titulaire" });
      const [paiementEnRetard] = await db
        .insert(paiements)
        .values({ bailId: bail.id, type: "loyer", montant: "800.00", dateEcheance: "2026-06-05" })
        .returning();
      if (!paiementEnRetard) throw new Error("Échec de l'insertion du paiement de test");

      await alertesJobService.genererAlertes("2026-06-11");
      await tachesJobService.genererTachesDepuisAlertes();

      const [tacheCreee] = await tachesService.findAll({ type: "impaye", bailId: bail.id });
      const metadata = tacheCreee?.metadata as Record<string, unknown> | null;
      expect(metadata?.notificationObjet).toBe(`Objet Immeuble Tâches Test — n°1`);
      expect(metadata?.notificationCorps).toBe(
        "Ilan Devos doit 800.00 € (loyer) depuis le 2026-06-05, bien Immeuble Tâches Test — n°1."
      );
      expect(metadata?.notificationIndisponible).toBeUndefined();
    });

    it("impaye : bail avec uniquement un colocataire (pas de titulaire) — signal explicite, jamais un envoi silencieux", async () => {
      const modelesCourrierService = moduleRef.get(ModelesCourrierService);
      await modelesCourrierService.upsertModeleCourrier({
        code: "impaye",
        nom: "Impayé (test)",
        canal: "email",
        objet: "Objet",
        corps: "{{nomLocataire}} {{libelleBien}} {{montant}} {{dateEcheance}} {{typePaiement}}",
        variablesRequises: ["nomLocataire", "libelleBien", "montant", "dateEcheance", "typePaiement"],
        organisationId
      });

      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-01-01",
        loyerMensuel: "800.00",
        jourEcheance: 5
      });
      await bauxService.activer(bail.id);
      for (const echeanceEntree of await db.select().from(paiements).where(eq(paiements.bailId, bail.id))) {
        await db.update(paiements).set({ archivedAt: new Date() }).where(eq(paiements.id, echeanceEntree.id));
      }
      const [locataire] = await db.insert(locataires).values({ nom: "Colocataire", prenom: "Seul" }).returning();
      if (!locataire) throw new Error("Échec de l'insertion du locataire de test");
      // role='colocataire' uniquement — aucun titulaire sur ce bail.
      await db.insert(bailLocataires).values({ bailId: bail.id, locataireId: locataire.id, role: "colocataire" });
      const [paiementEnRetard] = await db
        .insert(paiements)
        .values({ bailId: bail.id, type: "loyer", montant: "800.00", dateEcheance: "2026-06-05" })
        .returning();
      if (!paiementEnRetard) throw new Error("Échec de l'insertion du paiement de test");

      await alertesJobService.genererAlertes("2026-06-11");
      await tachesJobService.genererTachesDepuisAlertes();

      const [tacheCreee] = await tachesService.findAll({ type: "impaye", bailId: bail.id });
      const metadata = tacheCreee?.metadata as Record<string, unknown> | null;
      expect(metadata?.notificationIndisponible).toBe(true);
      expect(metadata?.motifNotificationIndisponible).toBe("aucun titulaire actif sur le bail");
      expect(metadata?.notificationObjet).toBeUndefined();
    });

    it("entretien_equipement : aucun bail actif sur l'appartement — signal explicite", async () => {
      const [equipement] = await db
        .insert(equipements)
        .values({
          appartementId,
          type: "chaudiere",
          dateDernierEntretien: "2025-01-01",
          intervalleEntretienMois: 12
        })
        .returning();
      if (!equipement) throw new Error("Échec de l'insertion de l'équipement de test");

      // Aucun bail sur cet appartement du tout — vacant.
      await alertesJobService.genererAlertes("2026-07-01");
      await tachesJobService.genererTachesDepuisAlertes();

      const [tacheCreee] = await tachesService.findAll({ type: "entretien_equipement", appartementId });
      const metadata = tacheCreee?.metadata as Record<string, unknown> | null;
      expect(metadata?.notificationIndisponible).toBe(true);
      expect(metadata?.motifNotificationIndisponible).toBe("aucun bail actif sur cet appartement");
    });

    it("entretien_equipement : titulaire résolu via le bail actif de l'appartement — notification générée", async () => {
      const modelesCourrierService = moduleRef.get(ModelesCourrierService);
      await modelesCourrierService.upsertModeleCourrier({
        code: "entretien_equipement",
        nom: "Entretien (test)",
        canal: "email",
        objet: null,
        corps: "{{nomLocataire}} {{libelleBien}} {{typeEquipement}} {{dateEcheance}}",
        variablesRequises: ["nomLocataire", "libelleBien", "typeEquipement", "dateEcheance"],
        organisationId
      });

      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-01-01",
        loyerMensuel: "800.00",
        jourEcheance: 5
      });
      await bauxService.activer(bail.id);
      const [locataire] = await db.insert(locataires).values({ nom: "Devos", prenom: "Ilan" }).returning();
      if (!locataire) throw new Error("Échec de l'insertion du locataire de test");
      await db.insert(bailLocataires).values({ bailId: bail.id, locataireId: locataire.id, role: "titulaire" });
      const [equipement] = await db
        .insert(equipements)
        .values({
          appartementId,
          type: "ballon_eau_chaude",
          dateDernierEntretien: "2025-01-01",
          intervalleEntretienMois: 12
        })
        .returning();
      if (!equipement) throw new Error("Échec de l'insertion de l'équipement de test");

      await alertesJobService.genererAlertes("2026-07-01");
      await tachesJobService.genererTachesDepuisAlertes();

      const [tacheCreee] = await tachesService.findAll({ type: "entretien_equipement", appartementId });
      const metadata = tacheCreee?.metadata as Record<string, unknown> | null;
      expect(metadata?.notificationObjet).toBeNull();
      expect(metadata?.notificationCorps).toBe(
        "Ilan Devos Immeuble Tâches Test — n°1 ballon d'eau chaude 2026-01-01"
      );
    });

    it("document_expire (cas appartement) : titulaire résolu via le bail actif — notification générée", async () => {
      const modelesCourrierService = moduleRef.get(ModelesCourrierService);
      await modelesCourrierService.upsertModeleCourrier({
        code: "document_expire",
        nom: "Document expiré (test)",
        canal: "email",
        objet: "Objet",
        corps: "{{nomLocataire}} {{libelleBien}} {{nomDocument}} {{dateExpiration}}",
        variablesRequises: ["nomLocataire", "libelleBien", "nomDocument", "dateExpiration"],
        organisationId
      });

      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-01-01",
        loyerMensuel: "800.00",
        jourEcheance: 5
      });
      await bauxService.activer(bail.id);
      const [locataire] = await db.insert(locataires).values({ nom: "Devos", prenom: "Ilan" }).returning();
      if (!locataire) throw new Error("Échec de l'insertion du locataire de test");
      await db.insert(bailLocataires).values({ bailId: bail.id, locataireId: locataire.id, role: "titulaire" });
      const [document] = await db
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
      if (!document) throw new Error("Échec de l'insertion du document de test");

      await alertesJobService.genererAlertes("2026-07-01");
      await tachesJobService.genererTachesDepuisAlertes();

      const [tacheCreee] = await tachesService.findAll({ type: "document_expire", appartementId });
      const metadata = tacheCreee?.metadata as Record<string, unknown> | null;
      expect(metadata?.notificationCorps).toBe(
        "Ilan Devos Immeuble Tâches Test — n°1 diagnostic-expire.pdf 2026-06-01"
      );
    });

    it("document_expire (cas bail) : titulaire résolu directement via bailId — notification générée", async () => {
      const modelesCourrierService = moduleRef.get(ModelesCourrierService);
      await modelesCourrierService.upsertModeleCourrier({
        code: "document_expire",
        nom: "Document expiré (test)",
        canal: "email",
        objet: "Objet",
        corps: "{{nomLocataire}} {{libelleBien}} {{nomDocument}} {{dateExpiration}}",
        variablesRequises: ["nomLocataire", "libelleBien", "nomDocument", "dateExpiration"],
        organisationId
      });

      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-01-01",
        loyerMensuel: "800.00",
        jourEcheance: 5
      });
      await bauxService.activer(bail.id);
      const [locataire] = await db.insert(locataires).values({ nom: "Devos", prenom: "Ilan" }).returning();
      if (!locataire) throw new Error("Échec de l'insertion du locataire de test");
      await db.insert(bailLocataires).values({ bailId: bail.id, locataireId: locataire.id, role: "titulaire" });
      const [document] = await db
        .insert(documents)
        .values({
          entiteType: "bail",
          entiteId: bail.id,
          categorie: "assurance",
          dateExpiration: "2026-06-01",
          nomFichier: "assurance-expiree.pdf",
          mimeType: "application/pdf",
          tailleOctets: 100,
          cheminStockage: "x"
        })
        .returning();
      if (!document) throw new Error("Échec de l'insertion du document de test");

      await alertesJobService.genererAlertes("2026-07-01");
      await tachesJobService.genererTachesDepuisAlertes();

      const [tacheCreee] = await tachesService.findAll({ type: "document_expire", bailId: bail.id });
      const metadata = tacheCreee?.metadata as Record<string, unknown> | null;
      expect(metadata?.notificationCorps).toBe(
        "Ilan Devos Immeuble Tâches Test — n°1 assurance-expiree.pdf 2026-06-01"
      );
    });

    it("document_expire (cas bien) : hors périmètre, aucune tentative de notification", async () => {
      const [document] = await db
        .insert(documents)
        .values({
          entiteType: "bien",
          entiteId: bienId,
          categorie: "assurance",
          dateExpiration: "2026-06-01",
          nomFichier: "assurance-bien-expiree.pdf",
          mimeType: "application/pdf",
          tailleOctets: 100,
          cheminStockage: "x"
        })
        .returning();
      if (!document) throw new Error("Échec de l'insertion du document de test");

      await alertesJobService.genererAlertes("2026-07-01");
      await tachesJobService.genererTachesDepuisAlertes();

      // findAll() n'a pas de filtre bienId (Étape 1) — scoping client-side.
      const toutes = await tachesService.findAll({ type: "document_expire" });
      const tacheCreee = toutes.find((t) => t.bienId === bienId);
      expect(tacheCreee?.metadata).toBeNull();
    });
  });
});

// Vérifie le périmètre exact du Module Tâches, Étape 5 (docs/backlog.md,
// docs/data-dictionary.md section "Révision de loyer") : détection de
// l'anniversaire, absence de garde-fou quand un indice manque encore,
// idempotence par année, et appliquerRevision (historique + loyerMensuel +
// notification + statut en_cours, jamais fait directement).
describe("Tâches — révision de loyer (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let tachesJobService: TachesJobService;
  let tachesService: TachesService;
  let modelesCourrierService: ModelesCourrierService;
  let alertesJobService: AlertesJobService;
  let db: Database;
  let organisationId: string;
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
        AlertesModule,
        IndicesIrlModule,
        ModelesCourrierModule,
        TachesModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    bauxService = moduleRef.get(BauxService);
    tachesJobService = moduleRef.get(TachesJobService);
    tachesService = moduleRef.get(TachesService);
    modelesCourrierService = moduleRef.get(ModelesCourrierService);
    alertesJobService = moduleRef.get(AlertesJobService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Révision Loyer Intégration" })
      .returning();
    if (!organisation) throw new Error("Échec de l'insertion de l'organisation de test");
    organisationId = organisation.id;
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `revision-loyer-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Révision",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) throw new Error("Échec de l'insertion de l'utilisateur de test");

    const sci = await scisService.create(user.id, {
      nom: "SCI Révision Loyer Test",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(user.id, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Révision Loyer Test",
      adresse: "1 rue de la Révision",
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

    // Modèle réel upserté directement ici (hermétique, indépendant de
    // l'exécution préalable de seed-modele-revision-loyer.ts).
    await modelesCourrierService.upsertModeleCourrier({
      code: "revision_loyer",
      nom: "Révision annuelle du loyer",
      canal: "email",
      objet: "Révision de votre loyer — {{libelleBien}}",
      corps:
        "Bonjour {{nomLocataire}}, nouveau loyer pour {{libelleBien}} : {{loyerApres}} € (au lieu de {{loyerAvant}} €) à compter du {{dateEffet}}.",
      variablesRequises: ["nomLocataire", "libelleBien", "loyerAvant", "loyerApres", "dateEffet"],
      organisationId
    });
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  async function creerBailAvecClauseIndexation(dateDebut: string, trimestre: number) {
    const bail = await bauxService.create({
      appartementId,
      typeBail: "vide",
      dateDebut,
      loyerMensuel: "800.00",
      jourEcheance: 5
    });
    await bauxService.activer(bail.id);
    await bauxService.update(bail.id, { trimestreReferenceRevision: trimestre });
    return bail;
  }

  it("crée une tâche à la date anniversaire quand les deux indices sont disponibles", async () => {
    await creerBailAvecClauseIndexation("1998-06-15", 2);
    await db.insert(indicesIrl).values([
      { annee: 1999, trimestre: 2, valeur: "145.50" },
      { annee: 1998, trimestre: 2, valeur: "143.00" }
    ]);

    const nombreCreees = await tachesJobService.genererTachesRevisionLoyer("1999-06-15");

    expect(nombreCreees).toBe(1);
    const [tacheCreee] = await tachesService.findAll({ type: "revision_loyer" });
    expect(tacheCreee).toBeDefined();
    expect(tacheCreee?.origine).toBe("planifiee");
    expect(tacheCreee?.statut).toBe("a_faire");
    expect(tacheCreee?.dateEcheance).toBe("1999-06-15");
    expect(tacheCreee?.periodeRecurrence).toBe("1999");
    expect(tacheCreee?.appartementId).toBe(appartementId);
    const metadata = tacheCreee?.metadata as Record<string, unknown>;
    expect(metadata.loyerActuel).toBe("800.00");
    expect(metadata.loyerPropose).toBe("813.98"); // 800 * 145.50 / 143.00, tronqué
    expect(metadata.trimestreReference).toBe(2);
    expect(metadata.anneeReference).toBe(1999);
  });

  it("ne crée rien si l'indice de référence n'est pas encore publié (le job réessaiera le lendemain)", async () => {
    await creerBailAvecClauseIndexation("1998-06-15", 2);
    // Seul l'indice précédent est publié — le trimestre courant ne l'est pas encore.
    await db.insert(indicesIrl).values([{ annee: 1998, trimestre: 2, valeur: "143.00" }]);

    const nombreCreees = await tachesJobService.genererTachesRevisionLoyer("1999-06-15");

    expect(nombreCreees).toBe(0);
    expect(await tachesService.findAll({ type: "revision_loyer" })).toHaveLength(0);
  });

  it("ne crée rien en dehors de la date anniversaire", async () => {
    await creerBailAvecClauseIndexation("1998-06-15", 2);
    await db.insert(indicesIrl).values([
      { annee: 1999, trimestre: 2, valeur: "145.50" },
      { annee: 1998, trimestre: 2, valeur: "143.00" }
    ]);

    const nombreCreees = await tachesJobService.genererTachesRevisionLoyer("1999-06-16");

    expect(nombreCreees).toBe(0);
  });

  it("est idempotent : exécuté deux fois pour la même année, ne crée jamais de deuxième tâche", async () => {
    await creerBailAvecClauseIndexation("1998-06-15", 2);
    await db.insert(indicesIrl).values([
      { annee: 1999, trimestre: 2, valeur: "145.50" },
      { annee: 1998, trimestre: 2, valeur: "143.00" }
    ]);

    await tachesJobService.genererTachesRevisionLoyer("1999-06-15");
    const secondPassage = await tachesJobService.genererTachesRevisionLoyer("1999-06-15");

    expect(secondPassage).toBe(0);
    expect(await tachesService.findAll({ type: "revision_loyer" })).toHaveLength(1);
  });

  it("appliquerRevision : historique créé, loyerMensuel mis à jour, notification résolue, statut en_cours (jamais fait)", async () => {
    const bail = await creerBailAvecClauseIndexation("1998-06-15", 2);
    const [locataire] = await db.insert(locataires).values({ nom: "Devos", prenom: "Ilan" }).returning();
    if (!locataire) throw new Error("Échec de l'insertion du locataire de test");
    await db.insert(bailLocataires).values({ bailId: bail.id, locataireId: locataire.id, role: "titulaire" });
    await db.insert(indicesIrl).values([
      { annee: 1999, trimestre: 2, valeur: "145.50" },
      { annee: 1998, trimestre: 2, valeur: "143.00" }
    ]);
    await tachesJobService.genererTachesRevisionLoyer("1999-06-15");
    const [tacheCreee] = await tachesService.findAll({ type: "revision_loyer" });
    if (!tacheCreee) throw new Error("Tâche revision_loyer attendue introuvable");

    // Montant ajusté manuellement, différent du montant proposé par le job
    // (813.98) — vérifie que l'ajustement avant application est réellement
    // pris en compte, pas seulement le montant calculé automatiquement.
    const tacheAppliquee = await tachesService.appliquerRevision(tacheCreee.id, "810.00");

    expect(tacheAppliquee.statut).toBe("en_cours");
    const metadata = tacheAppliquee.metadata as Record<string, unknown>;
    expect(metadata.notificationObjet).toBe("Révision de votre loyer — Immeuble Révision Loyer Test — n°1");
    expect(metadata.notificationCorps).toBe(
      "Bonjour Ilan Devos, nouveau loyer pour Immeuble Révision Loyer Test — n°1 : 810.00 € (au lieu de 800.00 €) à compter du 1999-06-15."
    );

    const [ligneHistorique] = await db.select().from(revisionLoyer).where(eq(revisionLoyer.bailId, bail.id));
    expect(ligneHistorique).toBeDefined();
    expect(ligneHistorique?.loyerAvant).toBe("800.00");
    expect(ligneHistorique?.loyerApres).toBe("810.00");
    expect(ligneHistorique?.trimestreReference).toBe(2);
    expect(ligneHistorique?.anneeReference).toBe(1999);
    expect(ligneHistorique?.indiceReferenceValeur).toBe("145.50");
    expect(ligneHistorique?.indicePrecedentValeur).toBe("143.00");

    const [bailMisAJour] = await db.select().from(baux).where(eq(baux.id, bail.id));
    expect(bailMisAJour?.loyerMensuel).toBe("810.00");
  });

  it("appliquerRevision rejette une tâche déjà appliquée (statut != a_faire)", async () => {
    await creerBailAvecClauseIndexation("1998-06-15", 2);
    await db.insert(indicesIrl).values([
      { annee: 1999, trimestre: 2, valeur: "145.50" },
      { annee: 1998, trimestre: 2, valeur: "143.00" }
    ]);
    await tachesJobService.genererTachesRevisionLoyer("1999-06-15");
    const [tacheCreee] = await tachesService.findAll({ type: "revision_loyer" });
    if (!tacheCreee) throw new Error("Tâche revision_loyer attendue introuvable");
    await tachesService.appliquerRevision(tacheCreee.id, "810.00");

    await expect(tachesService.appliquerRevision(tacheCreee.id, "820.00")).rejects.toThrow();
  });

  it("appliquerRevision rejette une tâche qui n'est pas de type revision_loyer", async () => {
    const bail = await creerBailAvecClauseIndexation("1998-06-15", 2);
    const [paiementEnRetard] = await db
      .insert(paiements)
      .values({ bailId: bail.id, type: "loyer", montant: "800.00", dateEcheance: "2020-06-05" })
      .returning();
    if (!paiementEnRetard) throw new Error("Échec de l'insertion du paiement de test");
    // Réutilise le mécanisme alertes -> tâche pour obtenir une vraie tâche
    // d'un autre type, plutôt que de fabriquer une ligne tache hors du
    // chemin applicatif réel.
    await alertesJobService.genererAlertes("2020-06-20");
    await tachesJobService.genererTachesDepuisAlertes();
    const [tacheImpaye] = await tachesService.findAll({ type: "impaye" });
    if (!tacheImpaye) throw new Error("Tâche impaye attendue introuvable");

    await expect(tachesService.appliquerRevision(tacheImpaye.id, "999.00")).rejects.toThrow();
  });
});

// Vérifie le périmètre exact du Module Tâches, Étape 4 (docs/backlog.md,
// docs/data-dictionary.md section "Quittance mensuelle") : génération
// uniquement pour un paiement de loyer effectivement RÉGLÉ (jamais anticipée
// sur une échéance à venir), idempotence par paiement (paiementId), résolution
// du titulaire (locataireId) et de la notification.
describe("Tâches — quittance mensuelle (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let versementsService: VersementsService;
  let tachesJobService: TachesJobService;
  let tachesService: TachesService;
  let modelesCourrierService: ModelesCourrierService;
  let db: Database;
  let organisationId: string;
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
        ModelesCourrierModule,
        TachesModule
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
    tachesJobService = moduleRef.get(TachesJobService);
    tachesService = moduleRef.get(TachesService);
    modelesCourrierService = moduleRef.get(ModelesCourrierService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Quittance Intégration" })
      .returning();
    if (!organisation) throw new Error("Échec de l'insertion de l'organisation de test");
    organisationId = organisation.id;
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `quittance-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Quittance",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) throw new Error("Échec de l'insertion de l'utilisateur de test");

    const sci = await scisService.create(user.id, {
      nom: "SCI Quittance Test",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(user.id, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Quittance Test",
      adresse: "1 rue de la Quittance",
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

    await modelesCourrierService.upsertModeleCourrier({
      code: "quittance_mensuelle",
      nom: "Quittance de loyer mensuelle",
      canal: "email",
      objet: "Quittance de loyer — {{periode}} — {{libelleBien}}",
      corps: "Bonjour {{nomLocataire}}, quittance {{libelleBien}}, période {{periode}}, montant {{montant}} €.",
      variablesRequises: ["nomLocataire", "libelleBien", "periode", "montant"],
      organisationId
    });
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  // dateDebut = 1er du mois : l'échéance d'entrée générée par activer() est
  // un mois plein, sans prorata (voir calculerMontantEcheanceEntree,
  // packages/core) — simplifie le calcul du versement de règlement.
  async function creerBailAvecEcheancePayee(): Promise<{ bailId: string; echeanceId: string }> {
    const bail = await bauxService.create({
      appartementId,
      typeBail: "vide",
      dateDebut: "2026-01-01",
      loyerMensuel: "700.00",
      provisionsCharges: "100.00",
      jourEcheance: 5
    });
    await bauxService.activer(bail.id);
    const [echeance] = await db.select().from(paiements).where(eq(paiements.bailId, bail.id)).limit(1);
    if (!echeance) throw new Error("Échéance d'entrée attendue introuvable");
    await versementsService.ajouter({
      paiementId: echeance.id,
      montant: "800.00",
      mode: "virement",
      dateVersement: "2026-01-05"
    });
    return { bailId: bail.id, echeanceId: echeance.id };
  }

  it("crée une tâche pour un paiement de loyer réglé, résout le titulaire et la notification", async () => {
    const { bailId, echeanceId } = await creerBailAvecEcheancePayee();
    const [locataire] = await db.insert(locataires).values({ nom: "Devos", prenom: "Ilan" }).returning();
    if (!locataire) throw new Error("Échec de l'insertion du locataire de test");
    await db.insert(bailLocataires).values({ bailId, locataireId: locataire.id, role: "titulaire" });

    // Compte global non vérifié ici : ce job est volontairement non scopé
    // (il tourne sur tous les paiements réglés, toutes organisations
    // confondues) et la base de dev locale contient une vraie échéance
    // réglée d'une session antérieure — seule la tâche du bail de CE test
    // fait foi.
    await tachesJobService.genererTachesQuittanceMensuelle();
    const [tacheCreee] = await tachesService.findAll({ type: "quittance_mensuelle", bailId });
    expect(tacheCreee).toBeDefined();
    expect(tacheCreee?.origine).toBe("planifiee");
    expect(tacheCreee?.statut).toBe("a_faire");
    expect(tacheCreee?.bailId).toBe(bailId);
    expect(tacheCreee?.appartementId).toBe(appartementId);
    expect(tacheCreee?.paiementId).toBe(echeanceId);
    expect(tacheCreee?.locataireId).toBe(locataire.id);
    const metadata = tacheCreee?.metadata as Record<string, unknown>;
    expect(metadata.notificationObjet).toBe("Quittance de loyer — janvier 2026 — Immeuble Quittance Test — n°1");
    expect(metadata.notificationCorps).toBe(
      "Bonjour Ilan Devos, quittance Immeuble Quittance Test — n°1, période janvier 2026, montant 800.00 €."
    );
  });

  it("ne crée rien pour une échéance encore impayée ou partielle", async () => {
    const bail = await bauxService.create({
      appartementId,
      typeBail: "vide",
      dateDebut: "2026-01-01",
      loyerMensuel: "700.00",
      provisionsCharges: "100.00",
      jourEcheance: 5
    });
    await bauxService.activer(bail.id);
    // Ni versement (reste impaye), ni tâche.

    await tachesJobService.genererTachesQuittanceMensuelle();

    expect(await tachesService.findAll({ type: "quittance_mensuelle", bailId: bail.id })).toHaveLength(0);
  });

  it("ne crée rien pour un paiement type='charges' ou 'depot_garantie', même réglé", async () => {
    const bail = await bauxService.create({
      appartementId,
      typeBail: "vide",
      dateDebut: "2026-01-01",
      loyerMensuel: "700.00",
      jourEcheance: 5
    });
    await bauxService.activer(bail.id);
    // Insertion directe (hors chemin applicatif normal, aucun service ne
    // crée aujourd'hui de paiement type='charges'/'depot_garantie' — voir
    // l'audit du 2026-08-31, docs/backlog.md) : statut='paye' posé
    // directement ici, uniquement pour isoler le filtre `type` du job,
    // pas pour tester calculerStatutPaiement.
    await db.insert(paiements).values({
      bailId: bail.id,
      type: "depot_garantie",
      statut: "paye",
      montant: "700.00",
      dateEcheance: "2026-01-01"
    });

    await tachesJobService.genererTachesQuittanceMensuelle();

    expect(await tachesService.findAll({ type: "quittance_mensuelle", bailId: bail.id })).toHaveLength(0);
  });

  it("est idempotent : deux passages successifs ne créent jamais de deuxième tâche pour le même paiement", async () => {
    const { bailId } = await creerBailAvecEcheancePayee();

    await tachesJobService.genererTachesQuittanceMensuelle();
    await tachesJobService.genererTachesQuittanceMensuelle();

    expect(await tachesService.findAll({ type: "quittance_mensuelle", bailId })).toHaveLength(1);
  });

  it("aucun titulaire actif sur le bail : la tâche se crée quand même, locataireId null, signal notificationIndisponible", async () => {
    const { bailId } = await creerBailAvecEcheancePayee();
    // Aucun bail_locataires inséré : ni titulaire, ni colocataire.

    await tachesJobService.genererTachesQuittanceMensuelle();

    const [tacheCreee] = await tachesService.findAll({ type: "quittance_mensuelle", bailId });
    expect(tacheCreee).toBeDefined();
    expect(tacheCreee?.locataireId).toBeNull();
    const metadata = tacheCreee?.metadata as Record<string, unknown>;
    expect(metadata.notificationIndisponible).toBe(true);
    expect(metadata.motifNotificationIndisponible).toBe("aucun titulaire actif sur le bail");
  });
});
