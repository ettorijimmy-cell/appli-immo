import { randomUUID } from "crypto";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { calculerMontantEcheanceEntree, calculerProrataOccupationPartielle } from "core";
import {
  appartements,
  baux,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  organisations,
  paiements,
  utilisateurs,
  versements,
  type Database
} from "db";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuthModule } from "../auth/auth.module";
import { BailLocatairesModule } from "../bail-locataires/bail-locataires.module";
import { BailLocatairesService } from "../bail-locataires/bail-locataires.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { GarantsModule } from "../garants/garants.module";
import { GarantsService } from "../garants/garants.service";
import { ImmeublesModule } from "../immeubles/immeubles.module";
import { ImmeublesService } from "../immeubles/immeubles.service";
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { BauxModule } from "./baux.module";
import { BauxService } from "./baux.service";
import { CreateBailDto } from "./dto/create-bail.dto";

// Vérifie le critère de complétion du Module 3 (docs/backlog.md) : créer un
// bail avec deux colocataires, vérifier le passage automatique de
// l'appartement en statut loué, ainsi que la règle critique de transition
// (jamais contournable par inadvertance). Chaque test tourne dans sa propre
// transaction annulée dans afterEach — voir test-utils/transactional-test.ts.
describe("Locataires & Baux — cycle de vie complet (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let scisService: ScisService;
  let immeublesService: ImmeublesService;
  let appartementsService: AppartementsService;
  let locatairesService: LocatairesService;
  let garantsService: GarantsService;
  let bauxService: BauxService;
  let bailLocatairesService: BailLocatairesService;
  let requestContextService: RequestContextService;
  let db: Database;
  let userId: string;
  let appartementId: string;

  beforeEach(async () => {
    db = await begin();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        CommonModule,
        DatabaseModule,
        UsersModule,
        AuthModule,
        ScisModule,
        ImmeublesModule,
        AppartementsModule,
        LocatairesModule,
        GarantsModule,
        BauxModule,
        BailLocatairesModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    immeublesService = moduleRef.get(ImmeublesService);
    appartementsService = moduleRef.get(AppartementsService);
    locatairesService = moduleRef.get(LocatairesService);
    garantsService = moduleRef.get(GarantsService);
    bauxService = moduleRef.get(BauxService);
    bailLocatairesService = moduleRef.get(BailLocatairesService);
    requestContextService = moduleRef.get(RequestContextService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Baux Intégration" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }

    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `baux-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Baux",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    userId = user.id;

    const sci = await scisService.create(userId, { nom: "SCI Baux Test", regimeFiscal: "IR" });
    const immeuble = await immeublesService.create({
      sciId: sci.id,
      nom: "Immeuble Baux Test",
      adresse: "1 rue du Bail"
    });
    const appartement = await appartementsService.create({
      immeubleId: immeuble.id,
      numero: "1",
      type: "T2",
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

  it("pré-remplit le loyer depuis loyer_reference, active le bail avec deux colocataires et fait passer l'appartement à loué", async () => {
    const locataire1 = await locatairesService.create({ nom: "Dupont", prenom: "Alice" });
    const locataire2 = await locatairesService.create({ nom: "Martin", prenom: "Bob" });

    const bail = await bauxService.create({
      appartementId,
      typeBail: "vide",
      dateDebut: "2026-08-01",
      jourEcheance: 5
    });
    expect(bail.statut).toBe("brouillon");
    expect(bail.loyerMensuel).toBe("800.00");

    await bailLocatairesService.create({ bailId: bail.id, locataireId: locataire1.id, role: "titulaire" });
    await bailLocatairesService.create({ bailId: bail.id, locataireId: locataire2.id, role: "colocataire" });

    const liens = await bailLocatairesService.findAll(bail.id);
    expect(liens).toHaveLength(2);
    expect(liens.map((lien) => lien.role).sort()).toEqual(["colocataire", "titulaire"]);

    const bailActive = await bauxService.activer(bail.id);
    expect(bailActive.statut).toBe("actif");

    const [appartementApresActivation] = await db
      .select()
      .from(appartements)
      .where(eq(appartements.id, appartementId));
    expect(appartementApresActivation?.statut).toBe("loue");
  });

  it("refuse d'activer un bail si l'appartement n'est pas vacant (empêche deux baux actifs simultanés)", async () => {
    const bailA = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-08-01", jourEcheance: 5 });
    await bauxService.activer(bailA.id);

    const bailB = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-09-01", jourEcheance: 5 });
    await expect(bauxService.activer(bailB.id)).rejects.toThrow(/déjà actif ou en préavis/i);

    const bailBApresEchec = await bauxService.findById(bailB.id);
    expect(bailBApresEchec?.statut).toBe("brouillon");
  });

  it("refuse d'activer un second bail même si le statut appartement a été remis à vacant manuellement pendant que le premier est actif", async () => {
    const bailA = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-08-01", jourEcheance: 5 });
    await bauxService.activer(bailA.id);

    // Correction manuelle (Module 2) qui remet l'appartement à vacant alors
    // que bailA est toujours réellement actif dessus — ne doit jamais
    // permettre l'activation d'un second bail en s'appuyant uniquement sur
    // ce champ miroir.
    await appartementsService.update(appartementId, { statut: "vacant" });

    const bailB = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-09-01", jourEcheance: 5 });
    await expect(bauxService.activer(bailB.id)).rejects.toThrow(/déjà actif ou en préavis/i);

    const bailBApresEchec = await bauxService.findById(bailB.id);
    expect(bailBApresEchec?.statut).toBe("brouillon");
    const bailAInchange = await bauxService.findById(bailA.id);
    expect(bailAInchange?.statut).toBe("actif");
  });

  it("refuse d'activer un bail déjà actif (pas de double activation)", async () => {
    const bail = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-08-01", jourEcheance: 5 });
    await bauxService.activer(bail.id);

    await expect(bauxService.activer(bail.id)).rejects.toThrow(/brouillon/i);
  });

  it("résilie un bail actif et repasse l'appartement à vacant", async () => {
    const bail = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-08-01", jourEcheance: 5 });
    await bauxService.activer(bail.id);

    const bailResilie = await bauxService.resilier(bail.id, { dateFin: "2027-01-31" });
    expect(bailResilie.statut).toBe("resilie");
    expect(bailResilie.dateFin).toBe("2027-01-31");

    const [appartementApresResiliation] = await db
      .select()
      .from(appartements)
      .where(eq(appartements.id, appartementId));
    expect(appartementApresResiliation?.statut).toBe("vacant");
  });

  it("ne réécrase jamais un statut d'appartement modifié manuellement entre-temps (ex. travaux) lors d'une résiliation", async () => {
    const bail = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-08-01", jourEcheance: 5 });
    await bauxService.activer(bail.id);

    // Correction manuelle pendant que le bail est actif (ex. dégât des eaux
    // nécessitant des travaux) — voir Module 2, statut modifiable à la main.
    await appartementsService.update(appartementId, { statut: "travaux" });

    await bauxService.resilier(bail.id, {});

    const [appartementApresResiliation] = await db
      .select()
      .from(appartements)
      .where(eq(appartements.id, appartementId));
    expect(appartementApresResiliation?.statut).toBe("travaux");
  });

  it("refuse de résilier un bail qui n'est ni actif ni en préavis", async () => {
    const bail = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-08-01", jourEcheance: 5 });

    await expect(bauxService.resilier(bail.id, {})).rejects.toThrow(/actif ou en préavis/i);
  });

  it("archive un bail résilié, jamais supprimé, et refuse d'archiver un bail encore actif", async () => {
    const bailActif = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-08-01", jourEcheance: 5 });
    await bauxService.activer(bailActif.id);
    await expect(bauxService.archive(bailActif.id)).rejects.toThrow(/résilié/i);

    await bauxService.resilier(bailActif.id, {});
    const bailArchive = await bauxService.archive(bailActif.id);
    expect(bailArchive.statut).toBe("archive");
    expect(bailArchive.archivedAt).not.toBeNull();

    const [rowEnBase] = await db.select().from(baux).where(eq(baux.id, bailActif.id));
    expect(rowEnBase).toBeDefined();
    expect(rowEnBase?.statut).toBe("archive");
  });

  it("update() générique ne peut jamais changer le statut d'un bail, même si le champ est forcé", async () => {
    const bail = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-08-01", jourEcheance: 5 });

    // Simule un contournement du typage (bug ailleurs, appel non passé par
    // le ValidationPipe whitelist:true) : même ainsi, le service n'écrit
    // jamais `statut` (voir BauxService.update — champs listés
    // explicitement, pas de `...dto`).
    const dtoForce = { statut: "actif", dateFin: "2026-12-31" } as unknown as Parameters<
      typeof bauxService.update
    >[1];
    const resultat = await bauxService.update(bail.id, dtoForce);

    expect(resultat.statut).toBe("brouillon");
    expect(resultat.dateFin).toBe("2026-12-31");
  });

  it("update() autorise de corriger date_debut tant que le bail est en brouillon", async () => {
    const bail = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-08-01", jourEcheance: 5 });

    const resultat = await bauxService.update(bail.id, { dateDebut: "2026-08-15" });

    expect(resultat.dateDebut).toBe("2026-08-15");
  });

  it("update() refuse de modifier date_debut une fois le bail activé, avec un message explicite", async () => {
    const bail = await bauxService.create({
      appartementId,
      typeBail: "vide",
      dateDebut: "2026-08-01",
      loyerMensuel: "800.00",
      jourEcheance: 5
    });
    await bauxService.activer(bail.id);

    await expect(bauxService.update(bail.id, { dateDebut: "2026-09-01" })).rejects.toThrow(
      "Impossible de modifier la date de début d'un bail qui n'est plus en brouillon."
    );

    const [rowEnBase] = await db.select().from(baux).where(eq(baux.id, bail.id));
    expect(rowEnBase?.dateDebut).toBe("2026-08-01");
  });

  it("une mise à jour partielle ne touche pas aux autres champs du bail", async () => {
    const bail = await bauxService.create({
      appartementId,
      typeBail: "vide",
      dateDebut: "2026-08-01",
      loyerMensuel: "950.00"
    });

    const resultat = await bauxService.update(bail.id, { dateFin: "2027-07-31" });

    expect(resultat.dateFin).toBe("2027-07-31");
    expect(resultat.typeBail).toBe("vide");
    expect(resultat.loyerMensuel).toBe("950.00");
    expect(resultat.dateDebut).toBe("2026-08-01");
  });

  it("CRUD garants rattachés à un bail, jamais supprimés", async () => {
    const bail = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-08-01", jourEcheance: 5 });

    const garant = await garantsService.create({
      bailId: bail.id,
      nom: "Durand",
      prenom: "Claire",
      typeGarantie: "personne_physique"
    });
    expect(garant.bailId).toBe(bail.id);

    const garantsDuBail = await garantsService.findAll(bail.id);
    expect(garantsDuBail).toHaveLength(1);

    const garantArchive = await garantsService.archive(garant.id);
    expect(garantArchive.archivedAt).not.toBeNull();

    const garantEnBase = await garantsService.findById(garant.id);
    expect(garantEnBase).not.toBeNull();
    expect(garantEnBase?.archivedAt).not.toBeNull();
  });

  // Vérifie que mettreAJourAvecAudit (packages/db) fonctionne aussi bien
  // avec la transaction (`tx`) utilisée par activer()/resilier() qu'avec
  // `this.db` directement — les deux écritures de la même transaction
  // (bail ET appartement) doivent être timbrées.
  it("timbre updated_by/version sur les deux écritures d'une transaction (activer un bail)", async () => {
    const bail = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-08-01", jourEcheance: 5 });

    const bailActive = await requestContextService.executerAvecContexte(
      { utilisateurId: userId },
      () => bauxService.activer(bail.id)
    );
    expect(bailActive.updatedBy).toBe(userId);
    expect(bailActive.version).toBe(2);

    const appartementLoue = await appartementsService.findById(appartementId);
    expect(appartementLoue?.updatedBy).toBe(userId);
    expect(appartementLoue?.version).toBe(2);
  });

  // Génération des échéances à l'activation (docs/data-dictionary.md,
  // "Décision produit — génération des échéances à l'activation").
  describe("génération des échéances à l'activation", () => {
    it("refuse d'activer un bail si jour_echeance n'est pas renseigné", async () => {
      const bail = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-08-01" });
      await expect(bauxService.activer(bail.id)).rejects.toThrow(/jour d'échéance/i);
    });

    it("refuse d'activer un bail si le loyer mensuel n'est pas renseigné", async () => {
      // Appartement SANS loyer_reference : preremplirLoyerBail ne peut alors
      // rien préremplir, loyer_mensuel reste null.
      const sciSansLoyer = await scisService.create(userId, { nom: "SCI Sans Loyer", regimeFiscal: "IR" });
      const immeubleSansLoyer = await immeublesService.create({
        sciId: sciSansLoyer.id,
        nom: "Immeuble Sans Loyer",
        adresse: "9 rue du Test"
      });
      const appartementSansLoyer = await appartementsService.create({
        immeubleId: immeubleSansLoyer.id,
        numero: "9",
        type: "T1"
      });
      const bail = await bauxService.create({
        appartementId: appartementSansLoyer.id,
        typeBail: "vide",
        dateDebut: "2026-08-01",
        jourEcheance: 5
      });
      await expect(bauxService.activer(bail.id)).rejects.toThrow(/loyer mensuel/i);
    });

    it("génère le dépôt de garantie (si dû) et la première échéance de loyer à l'activation, toutes deux exigibles à date_debut", async () => {
      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-08-01",
        loyerMensuel: "800.00",
        provisionsCharges: "50.00",
        depotGarantie: "1600.00",
        jourEcheance: 5
      });

      await bauxService.activer(bail.id);

      const lignesGenerees = await db.select().from(paiements).where(eq(paiements.bailId, bail.id));
      expect(lignesGenerees).toHaveLength(2);

      const depot = lignesGenerees.find((ligne) => ligne.type === "depot_garantie");
      expect(depot?.montant).toBe("1600.00");
      // Exigible à date_debut (l'entrée réelle), jamais à la date
      // d'activation administrative — voir docs/data-dictionary.md.
      expect(depot?.dateEcheance).toBe("2026-08-01");
      expect(depot?.statut).toBe("impaye");

      const loyer = lignesGenerees.find((ligne) => ligne.type === "loyer");
      // date_debut tombe le 1er du mois : mois dû en entier, jour_echeance=5
      // n'a ici aucun effet (ni sur le montant, ni sur la date).
      expect(loyer?.montant).toBe(calculerMontantEcheanceEntree("800.00", "50.00", "2026-08-01"));
      expect(loyer?.montant).toBe("850.00");
      expect(loyer?.dateEcheance).toBe("2026-08-01");
      expect(loyer?.statut).toBe("impaye");
    });

    it("proratise la première échéance de loyer quand date_debut ne tombe pas le 1er du mois", async () => {
      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-08-20",
        loyerMensuel: "930.00",
        jourEcheance: 5
      });

      await bauxService.activer(bail.id);

      const [loyer] = await db
        .select()
        .from(paiements)
        .where(and(eq(paiements.bailId, bail.id), eq(paiements.type, "loyer")));
      // août = 31 jours, occupation du 20 au 31 inclus = 12 jours.
      // 930.00 / 31 * 12 jours = 360.00 exactement.
      expect(loyer?.montant).toBe(calculerMontantEcheanceEntree("930.00", null, "2026-08-20"));
      expect(loyer?.montant).toBe("360.00");
      expect(loyer?.dateEcheance).toBe("2026-08-20");
    });

    it("ne génère aucune ligne dépôt de garantie si depot_garantie est nul ou absent", async () => {
      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-08-01",
        loyerMensuel: "800.00",
        jourEcheance: 5
      });

      await bauxService.activer(bail.id);

      const lignesGenerees = await db.select().from(paiements).where(eq(paiements.bailId, bail.id));
      expect(lignesGenerees).toHaveLength(1);
      expect(lignesGenerees[0]?.type).toBe("loyer");
    });

    // Trouvé par financial-logic-reviewer : loyerMensuel/depotGarantie
    // n'avaient pas le même @Transform(normaliserMontant) que
    // provisionsCharges — une saisie à virgule décimale (ex. formulaire
    // manuel) aurait échoué à @IsNumberString() pour ces deux champs
    // seulement. Reproduit le chemin réel (ValidationPipe), comme pour le
    // même bug déjà corrigé sur les DTO paiements (docs/error-log.md,
    // [2026-07-27]).
    it("normalise la virgule décimale sur loyer_mensuel/depot_garantie comme sur provisions_charges", async () => {
      const dto = plainToInstance(CreateBailDto, {
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-08-01",
        loyerMensuel: "950,00",
        depotGarantie: "1900,00",
        provisionsCharges: "60,00",
        jourEcheance: 5
      });
      const erreurs = await validate(dto);
      expect(erreurs).toHaveLength(0);

      const bail = await bauxService.create(dto);
      expect(bail.loyerMensuel).toBe("950.00");
      expect(bail.depotGarantie).toBe("1900.00");
      expect(bail.provisionsCharges).toBe("60.00");
    });
  });

  // Prorata à la résiliation (docs/data-dictionary.md, "Décision produit —
  // prorata à la résiliation").
  describe("prorata de la dernière échéance à la résiliation", () => {
    it("proratise l'échéance de loyer du mois de résiliation si elle n'est pas encore réglée", async () => {
      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-08-01",
        loyerMensuel: "900.00",
        jourEcheance: 1
      });
      await bauxService.activer(bail.id);

      // Échéance du mois de résiliation, insérée directement (simule ce que
      // produirait le job planifié quotidien du Module 6, pas encore
      // implémenté) — impaye, comme au moment réel d'une résiliation.
      const [echeanceSeptembre] = await db
        .insert(paiements)
        .values({ bailId: bail.id, type: "loyer", montant: "900.00", dateEcheance: "2026-09-01" })
        .returning();
      if (!echeanceSeptembre) {
        throw new Error("Échec de l'insertion de l'échéance de test");
      }

      await bauxService.resilier(bail.id, { dateFin: "2026-09-15" });

      const [echeanceApresResiliation] = await db
        .select()
        .from(paiements)
        .where(eq(paiements.id, echeanceSeptembre.id));
      // Septembre = 30 jours, 15 jours occupés (1er au 15 inclus) : moitié du mois.
      expect(echeanceApresResiliation?.montant).toBe(calculerProrataOccupationPartielle("900.00", "2026-09-15"));
      expect(echeanceApresResiliation?.montant).toBe("450.00");
      expect(echeanceApresResiliation?.statut).toBe("impaye");
    });

    // Scénario découvreur du correctif "entrée + Cas B simplifié" : un bail
    // signé mi-mois, activé administrativement bien plus tard (sans effet
    // sur aucun calcul — date_activation n'entre plus dans le prorata,
    // voir docs/data-dictionary.md), puis résilié encore plus tard, dans un
    // troisième mois différent. Vérifie que l'entrée (Cas A, proratisée sur
    // date_debut) et la résiliation (Cas B, depuis le 1er du mois) sont
    // toutes deux correctement facturées, que le mois intermédiaire (jamais
    // couvert, job Module 6 pas implémenté) reste un trou assumé et non une
    // ligne erronée, et qu'aucun mois n'est facturé deux fois.
    it("bail signé mi-mois, activé plusieurs mois après, résilié encore plus tard : entrée et résiliation correctement facturées, aucun double comptage", async () => {
      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-06-15",
        loyerMensuel: "900.00",
        jourEcheance: 5
      });

      // Activation "aujourd'hui" (quelle que soit la date réelle
      // d'exécution du test) : administrativement plusieurs semaines après
      // date_debut, sans aucun effet sur le calcul qui suit.
      await bauxService.activer(bail.id);

      const [echeanceJuin] = await db
        .select()
        .from(paiements)
        .where(and(eq(paiements.bailId, bail.id), eq(paiements.type, "loyer")));
      // juin = 30 jours, occupation du 15 au 30 inclus = 16 jours.
      // 900.00 / 30 * 16 jours = 480.00 exactement.
      expect(echeanceJuin?.dateEcheance).toBe("2026-06-15");
      expect(echeanceJuin?.montant).toBe("480.00");

      // Résiliation en août : un troisième mois, différent de juin (entrée)
      // ET de juillet (trou intermédiaire jamais facturé, hors périmètre).
      await bauxService.resilier(bail.id, { dateFin: "2026-08-10" });

      const toutesLesLignes = await db.select().from(paiements).where(eq(paiements.bailId, bail.id));

      // Juin (entrée) reste inchangé, jamais retouché par la résiliation.
      const ligneJuinApres = toutesLesLignes.find((ligne) => ligne.id === echeanceJuin?.id);
      expect(ligneJuinApres?.montant).toBe("480.00");
      expect(ligneJuinApres?.dateEcheance).toBe("2026-06-15");

      // Juillet : aucune ligne — trou intermédiaire assumé, pas une erreur.
      const lignesJuillet = toutesLesLignes.filter((ligne) => ligne.dateEcheance.slice(0, 7) === "2026-07");
      expect(lignesJuillet).toHaveLength(0);

      // Août (résiliation, Cas B) facturé depuis son 1er jour — jamais
      // depuis la date d'activation administrative, qui n'intervient plus
      // dans ce calcul : 10 jours occupés sur 31.
      // 900.00 / 31 * 10 jours = 290.32 (tronqué).
      const ligneAout = toutesLesLignes.find((ligne) => ligne.dateEcheance.slice(0, 7) === "2026-08");
      expect(ligneAout).toBeDefined();
      expect(ligneAout?.montant).toBe(calculerProrataOccupationPartielle("900.00", "2026-08-10"));
      expect(ligneAout?.montant).toBe("290.32");
      expect(ligneAout?.statut).toBe("impaye");

      // Exactement deux lignes au total : entrée (juin) + résiliation
      // (août) — aucun double comptage.
      expect(toutesLesLignes).toHaveLength(2);
    });

    it("ne touche pas à l'échéance du mois de résiliation si elle est déjà réglée intégralement", async () => {
      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-08-01",
        loyerMensuel: "900.00",
        jourEcheance: 1
      });
      await bauxService.activer(bail.id);

      const [echeanceSeptembre] = await db
        .insert(paiements)
        .values({
          bailId: bail.id,
          type: "loyer",
          montant: "900.00",
          montantPaye: "900.00",
          statut: "paye",
          dateEcheance: "2026-09-01"
        })
        .returning();
      if (!echeanceSeptembre) {
        throw new Error("Échec de l'insertion de l'échéance de test");
      }

      await bauxService.resilier(bail.id, { dateFin: "2026-09-15" });

      const [echeanceApresResiliation] = await db
        .select()
        .from(paiements)
        .where(eq(paiements.id, echeanceSeptembre.id));
      // Trop-perçu non traité automatiquement (docs/backlog.md, dette
      // technique) : le montant réglé n'est jamais rétroactivement réduit.
      expect(echeanceApresResiliation?.montant).toBe("900.00");
      expect(echeanceApresResiliation?.statut).toBe("paye");
    });

    // Les deux scénarios de trop-perçu documentés (docs/backlog.md,
    // Financier #1) : signalé dans la réponse de resilier(), jamais créé
    // automatiquement en `remboursements` (décision D3, docs/data-
    // dictionary.md) — la création reste un acte humain explicite.
    it("signale un trop-perçu quand l'échéance du mois de résiliation était déjà réglée intégralement", async () => {
      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-08-01",
        loyerMensuel: "900.00",
        jourEcheance: 1
      });
      await bauxService.activer(bail.id);

      const [echeanceSeptembre] = await db
        .insert(paiements)
        .values({
          bailId: bail.id,
          type: "loyer",
          montant: "900.00",
          statut: "paye",
          dateEcheance: "2026-09-01"
        })
        .returning();
      if (!echeanceSeptembre) {
        throw new Error("Échec de l'insertion de l'échéance de test");
      }
      await db.insert(versements).values({
        paiementId: echeanceSeptembre.id,
        montant: "900.00",
        dateVersement: "2026-09-05",
        mode: "virement"
      });

      const resultat = await bauxService.resilier(bail.id, { dateFin: "2026-09-15" });

      // Septembre = 30 jours, 15 jours occupés : 900/30*15 = 450 vraiment
      // dus, mais 900 déjà reçus -> 450 de trop-perçu.
      expect(resultat.tropPercu).toEqual({ paiementId: echeanceSeptembre.id, montant: "450.00" });

      // Le montant stocké reste inchangé (échéance "paye", jamais touchée
      // automatiquement — comportement inchangé, voir test précédent).
      const [echeanceApresResiliation] = await db
        .select()
        .from(paiements)
        .where(eq(paiements.id, echeanceSeptembre.id));
      expect(echeanceApresResiliation?.montant).toBe("900.00");
      expect(echeanceApresResiliation?.statut).toBe("paye");
    });

    it("signale un trop-perçu quand un versement partiel dépasse le nouveau montant proratisé", async () => {
      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-08-01",
        loyerMensuel: "900.00",
        jourEcheance: 1
      });
      await bauxService.activer(bail.id);

      const [echeanceSeptembre] = await db
        .insert(paiements)
        .values({
          bailId: bail.id,
          type: "loyer",
          montant: "900.00",
          statut: "partiel",
          dateEcheance: "2026-09-01"
        })
        .returning();
      if (!echeanceSeptembre) {
        throw new Error("Échec de l'insertion de l'échéance de test");
      }
      // 700 € versés : moins que les 900 pleins, mais plus que les 450
      // vraiment dus après le prorata de résiliation.
      await db.insert(versements).values({
        paiementId: echeanceSeptembre.id,
        montant: "700.00",
        dateVersement: "2026-09-05",
        mode: "virement"
      });

      const resultat = await bauxService.resilier(bail.id, { dateFin: "2026-09-15" });

      expect(resultat.tropPercu).toEqual({ paiementId: echeanceSeptembre.id, montant: "250.00" });

      // Cette échéance N'ÉTAIT PAS "paye" avant résiliation (elle était
      // "partiel") : le montant est bien reproratisé à 450, et le statut
      // recalculé passe à "paye" (700 reçus >= 450 dus).
      const [echeanceApresResiliation] = await db
        .select()
        .from(paiements)
        .where(eq(paiements.id, echeanceSeptembre.id));
      expect(echeanceApresResiliation?.montant).toBe("450.00");
      expect(echeanceApresResiliation?.statut).toBe("paye");
    });

    // Cas B (docs/data-dictionary.md) : même très longtemps après
    // l'activation (aucun job Module 6 pour générer les mois
    // intermédiaires), le mois de la résiliation elle-même ne doit jamais
    // rester sans ligne de paiement — même si la période inoccupée-mais-
    // non-facturée entre l'activation et ce mois-là reste un vrai trou
    // (hors périmètre : backfill de plusieurs mois, jamais demandé ici).
    it("génère l'échéance manquante du mois de résiliation même après un long délai sans échéance intermédiaire", async () => {
      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-08-01",
        loyerMensuel: "900.00",
        jourEcheance: 1
      });
      await bauxService.activer(bail.id);

      // Résiliation avec date de fin loin dans le futur : aucune échéance
      // n'a jamais été générée pour ce mois-là (job Module 6 pas
      // implémenté), mais le mois de dateFin lui-même doit être facturé.
      await bauxService.resilier(bail.id, { dateFin: "2028-01-15" });

      const toutesLesLignes = await db.select().from(paiements).where(eq(paiements.bailId, bail.id));
      const lignesJanvier2028 = toutesLesLignes.filter(
        (ligne) => ligne.dateEcheance >= "2028-01-01" && ligne.dateEcheance < "2028-02-01"
      );
      expect(lignesJanvier2028).toHaveLength(1);
      // Le Cas B facture toujours depuis le 1er jour du mois de dateFin.
      // Janvier = 31 jours, 15 jours occupés (1er au 15 inclus).
      expect(lignesJanvier2028[0]?.montant).toBe(calculerProrataOccupationPartielle("900.00", "2028-01-15"));
      expect(lignesJanvier2028[0]?.montant).toBe("435.48");
      expect(lignesJanvier2028[0]?.statut).toBe("impaye");
    });

    it("rejette explicitement une résiliation dont dateFin précède dateDebut, sans rien modifier", async () => {
      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-08-15",
        loyerMensuel: "900.00",
        jourEcheance: 1
      });
      await bauxService.activer(bail.id);

      // dateFin antérieure à dateDebut (date_activation, purement
      // administrative, n'entre jamais dans cette comparaison — voir
      // activer() : ici elle serait "aujourd'hui", largement postérieure
      // aux deux, ce qui ne doit avoir aucune incidence).
      await expect(bauxService.resilier(bail.id, { dateFin: "2026-08-01" })).rejects.toThrow(
        /date de fin ne peut pas précéder/i
      );

      // Rien n'a été modifié : le bail reste actif, jamais passé à "résilié".
      const bailInchange = await bauxService.findById(bail.id);
      expect(bailInchange?.statut).toBe("actif");
      expect(bailInchange?.dateFin).toBeNull();

      // Et l'appartement reste "loué", jamais repassé à un autre statut.
      const [appartementInchange] = await db
        .select()
        .from(appartements)
        .where(eq(appartements.id, appartementId));
      expect(appartementInchange?.statut).toBe("loue");
    });

    it("accepte une résiliation dont dateFin est exactement dateDebut (un seul jour occupé), avec le bon montant", async () => {
      const bail = await bauxService.create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-08-15",
        loyerMensuel: "900.00",
        jourEcheance: 1
      });
      await bauxService.activer(bail.id);

      const bailResilie = await bauxService.resilier(bail.id, { dateFin: "2026-08-15" });
      expect(bailResilie.statut).toBe("resilie");
      expect(bailResilie.dateFin).toBe("2026-08-15");

      // Un seul jour réellement occupé (le 15 août, dateDebut = dateFin) :
      // 900.00 / 31 jours * 1 jour = 29.03 (tronqué) — pas une seconde
      // proratisation de l'échéance d'entrée déjà partielle (bug corrigé
      // par ce même correctif, voir le commentaire dans resilier()).
      const [echeanceAout] = await db
        .select()
        .from(paiements)
        .where(and(eq(paiements.bailId, bail.id), eq(paiements.type, "loyer")));
      expect(echeanceAout?.dateEcheance).toBe("2026-08-15");
      expect(echeanceAout?.montant).toBe(calculerProrataOccupationPartielle("900.00", "2026-08-15", "2026-08-15"));
      expect(echeanceAout?.montant).toBe("29.03");

      // Une seule ligne au total : l'échéance d'entrée (Cas A) mise à jour
      // sur place, jamais une seconde ligne créée pour le même mois.
      const toutesLesLignes = await db.select().from(paiements).where(eq(paiements.bailId, bail.id));
      expect(toutesLesLignes).toHaveLength(1);
    });
  });
});
