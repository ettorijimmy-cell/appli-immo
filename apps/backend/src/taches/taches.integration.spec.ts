import { randomUUID } from "crypto";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, documents, equipements, locataires, organisations, paiements, utilisateurs, type Database } from "db";
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
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { DocumentsModule } from "../documents/documents.module";
import { EquipementsModule } from "../equipements/equipements.module";
import { PaiementsModule } from "../paiements/paiements.module";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
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
  let db: Database;
  let organisationId: string;
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
});
