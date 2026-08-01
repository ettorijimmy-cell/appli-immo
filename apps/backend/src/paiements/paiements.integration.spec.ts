import { randomUUID } from "crypto";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, paiements, utilisateurs, versements, type Database } from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuthModule } from "../auth/auth.module";
import { BailLocatairesModule } from "../bail-locataires/bail-locataires.module";
import { BailLocatairesService } from "../bail-locataires/bail-locataires.service";
import { BauxModule } from "../baux/baux.module";
import { BauxService } from "../baux/baux.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { ImmeublesModule } from "../immeubles/immeubles.module";
import { ImmeublesService } from "../immeubles/immeubles.service";
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { PaiementsModule } from "./paiements.module";
import { PaiementsService } from "./paiements.service";
import { CreateVersementDto } from "../versements/dto/create-versement.dto";
import { VersementsModule } from "../versements/versements.module";
import { VersementsService } from "../versements/versements.service";

// Vérifie le critère de complétion du Module 5 (docs/backlog.md) : importer
// un relevé CSV, voir les paiements correspondants automatiquement
// rapprochés (proposés — jamais appliqués sans confirmation), corriger
// manuellement un rapprochement incorrect. Étendu par le chantier
// "versements & remboursements" (docs/data-dictionary.md) : un paiement
// peut désormais recevoir plusieurs versements, jamais un seul champ
// écrasé. Chaque test tourne dans sa propre transaction annulée dans
// afterEach — voir test-utils/transactional-test.ts.
describe("Paiements — versements, calcul de statut, rapprochement CSV (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let scisService: ScisService;
  let immeublesService: ImmeublesService;
  let appartementsService: AppartementsService;
  let locatairesService: LocatairesService;
  let bauxService: BauxService;
  let bailLocatairesService: BailLocatairesService;
  let paiementsService: PaiementsService;
  let versementsService: VersementsService;
  let requestContextService: RequestContextService;
  let db: Database;
  let userId: string;
  let bailId: string;

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
        BauxModule,
        BailLocatairesModule,
        PaiementsModule,
        VersementsModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    immeublesService = moduleRef.get(ImmeublesService);
    appartementsService = moduleRef.get(AppartementsService);
    locatairesService = moduleRef.get(LocatairesService);
    bauxService = moduleRef.get(BauxService);
    bailLocatairesService = moduleRef.get(BailLocatairesService);
    paiementsService = moduleRef.get(PaiementsService);
    versementsService = moduleRef.get(VersementsService);
    requestContextService = moduleRef.get(RequestContextService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Paiements Intégration" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }

    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `paiements-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Paiements",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    userId = user.id;

    const sci = await scisService.create(userId, { nom: "SCI Paiements Test", regimeFiscal: "IR", adresse: "1 rue de Test", codePostal: "75001", ville: "Paris" });
    const immeuble = await immeublesService.create({
      sciId: sci.id,
      nom: "Immeuble Paiements Test",
      adresse: "1 rue des Paiements",
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
      loyerReference: "850.00"
    });
    const bail = await bauxService.create({
      appartementId: appartement.id,
      typeBail: "vide",
      dateDebut: "2026-08-01",
      jourEcheance: 5
    });
    await bauxService.activer(bail.id);
    bailId = bail.id;

    // activer() génère désormais automatiquement la première échéance de
    // loyer (docs/data-dictionary.md), datée sur date_debut. Ces tests
    // portent sur des scénarios où le paiement est créé explicitement par
    // le test — l'échéance auto-générée par l'activation est hors sujet
    // ici et a ses propres tests dédiés (locataires-baux.integration.spec.ts).
    for (const echeanceGeneree of await paiementsService.findAll(bailId)) {
      await paiementsService.archive(echeanceGeneree.id);
    }
  });

  afterEach(async () => {
    await moduleRef.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  it("crée un paiement impaye par défaut, sans versement", async () => {
    const paiement = await paiementsService.create({
      bailId,
      type: "loyer",
      montant: "850.00",
      dateEcheance: "2026-09-01"
    });
    expect(paiement.statut).toBe("impaye");
    expect(await versementsService.findAll(paiement.id)).toHaveLength(0);
  });

  it("ajouter() un versement passe le statut à paye quand il couvre le montant dû", async () => {
    const paiement = await paiementsService.create({
      bailId,
      type: "loyer",
      montant: "850.00",
      dateEcheance: "2026-09-01"
    });

    const versement = await versementsService.ajouter({
      paiementId: paiement.id,
      montant: "850.00",
      mode: "virement",
      dateVersement: "2026-09-02"
    });
    expect(versement.mode).toBe("virement");
    expect(versement.dateVersement).toBe("2026-09-02");

    const paiementMisAJour = await paiementsService.findById(paiement.id);
    expect(paiementMisAJour?.statut).toBe("paye");
  });

  it("ajouter() un versement passe le statut à partiel quand il est inférieur au montant dû", async () => {
    const paiement = await paiementsService.create({
      bailId,
      type: "loyer",
      montant: "850.00",
      dateEcheance: "2026-09-01"
    });

    await versementsService.ajouter({
      paiementId: paiement.id,
      montant: "400.00",
      mode: "virement",
      dateVersement: "2026-09-02"
    });

    const paiementMisAJour = await paiementsService.findById(paiement.id);
    expect(paiementMisAJour?.statut).toBe("partiel");
  });

  // Deux versements distincts, y compris le même jour (confirmé en usage
  // réel) : cumulés, jamais l'un écrasant l'autre — c'est exactement la
  // limite que ce chantier corrige (docs/data-dictionary.md).
  it("plusieurs versements sur le même paiement s'additionnent, jamais ne s'écrasent", async () => {
    const paiement = await paiementsService.create({
      bailId,
      type: "loyer",
      montant: "800.00",
      dateEcheance: "2026-09-01"
    });

    await versementsService.ajouter({
      paiementId: paiement.id,
      montant: "400.00",
      mode: "virement",
      dateVersement: "2026-09-05"
    });
    let paiementMisAJour = await paiementsService.findById(paiement.id);
    expect(paiementMisAJour?.statut).toBe("partiel");

    // Second versement le MÊME jour que le premier (cas confirmé en usage
    // réel) : les deux doivent compter, pas seulement le dernier.
    await versementsService.ajouter({
      paiementId: paiement.id,
      montant: "400.00",
      mode: "especes",
      dateVersement: "2026-09-05"
    });
    paiementMisAJour = await paiementsService.findById(paiement.id);
    expect(paiementMisAJour?.statut).toBe("paye");

    const tousLesVersements = await versementsService.findAll(paiement.id);
    expect(tousLesVersements).toHaveLength(2);
    expect(tousLesVersements.every((v) => v.dateVersement === "2026-09-05")).toBe(true);
  });

  // Reproduit exactement le chemin réel (ValidationPipe : plainToInstance
  // + validate, avant que le contrôleur n'appelle le service) plutôt que
  // d'appeler ajouter() avec un objet déjà "propre" — sans ça, le test ne
  // verrait jamais le bug qu'il vérifie (@IsNumberString rejetait
  // "850,00" avant l'ajout du @Transform, voir docs/error-log.md).
  it("normalise virgule et point décimal vers un résultat identique en base (CSV vs saisie manuelle)", async () => {
    const paiementVirgule = await paiementsService.create({
      bailId,
      type: "loyer",
      montant: "850.00",
      dateEcheance: "2026-09-01"
    });
    const paiementPoint = await paiementsService.create({
      bailId,
      type: "loyer",
      montant: "850.00",
      dateEcheance: "2026-09-01"
    });

    async function ajouterViaDto(paiementId: string, montantBrut: string) {
      const dto = plainToInstance(CreateVersementDto, {
        paiementId,
        montant: montantBrut,
        mode: "virement",
        dateVersement: "2026-09-02"
      });
      const erreurs = await validate(dto);
      expect(erreurs).toHaveLength(0);
      return versementsService.ajouter(dto);
    }

    // "850,00" simule une ligne de relevé CSV (RapprochementCsvView),
    // "850.00" simule une saisie manuelle du formulaire.
    const resultatVirgule = await ajouterViaDto(paiementVirgule.id, "850,00");
    const resultatPoint = await ajouterViaDto(paiementPoint.id, "850.00");

    expect(resultatVirgule.montant).toBe("850.00");
    expect(resultatVirgule.montant).toBe(resultatPoint.montant);

    const statutVirgule = await paiementsService.findById(paiementVirgule.id);
    const statutPoint = await paiementsService.findById(paiementPoint.id);
    expect(statutVirgule?.statut).toBe(statutPoint?.statut);
  });

  it("update() recalcule le statut depuis les versements actifs si le montant dû change", async () => {
    const paiement = await paiementsService.create({
      bailId,
      type: "loyer",
      montant: "850.00",
      dateEcheance: "2026-09-01"
    });
    await versementsService.ajouter({
      paiementId: paiement.id,
      montant: "400.00",
      mode: "virement",
      dateVersement: "2026-09-02"
    });

    // Correction du montant dû (erreur de saisie initiale) : le paiement
    // devient intégralement couvert par le montant déjà reçu, sans jamais
    // repasser par versementsService.ajouter().
    const corrige = await paiementsService.update(paiement.id, { montant: "400.00" });
    expect(corrige.statut).toBe("paye");

    // update() ne porte aucun champ lié aux versements : même en forçant
    // le typage, rien ne serait écrit (voir UpdatePaiementDto).
    const dtoForce = { montant: "850.00" } as unknown as Parameters<typeof paiementsService.update>[1];
    const resultat = await paiementsService.update(paiement.id, dtoForce);
    expect(resultat.statut).toBe("partiel");
    const versementsActifs = await versementsService.findAll(paiement.id);
    expect(versementsActifs).toHaveLength(1);
    expect(versementsActifs[0]?.montant).toBe("400.00");
  });

  it("annuler() cible un versement précis, jamais tous d'un coup — le paiement redevient impaye si c'était le seul", async () => {
    const paiementA = await paiementsService.create({
      bailId,
      type: "loyer",
      montant: "850.00",
      dateEcheance: "2026-09-01"
    });

    // Rapprochement incorrect : ce virement ne correspondait pas réellement
    // à ce paiement.
    const versementIncorrect = await versementsService.ajouter({
      paiementId: paiementA.id,
      montant: "850.00",
      mode: "virement",
      dateVersement: "2026-09-03",
      referenceRapprochement: "VIR MAUVAIS LOCATAIRE"
    });

    const annule = await versementsService.annuler(versementIncorrect.id);
    expect(annule.archivedAt).not.toBeNull();
    // Les champs d'origine ne sont jamais modifiés par l'annulation, ne
    // sert que de trace historique (jamais de suppression physique).
    expect(annule.montant).toBe("850.00");
    expect(annule.referenceRapprochement).toBe("VIR MAUVAIS LOCATAIRE");

    const paiementApresAnnulation = await paiementsService.findById(paiementA.id);
    expect(paiementApresAnnulation?.statut).toBe("impaye");

    const corrige = await versementsService.ajouter({
      paiementId: paiementA.id,
      montant: "850.00",
      mode: "virement",
      dateVersement: "2026-09-03",
      referenceRapprochement: "VIR BON LOCATAIRE"
    });
    expect(corrige.referenceRapprochement).toBe("VIR BON LOCATAIRE");

    const paiementCorrige = await paiementsService.findById(paiementA.id);
    expect(paiementCorrige?.statut).toBe("paye");

    // Les deux versements existent toujours en base (le mauvais est
    // archivé, jamais supprimé), seul le second compte dans le statut.
    const tousLesVersements = await versementsService.findAll(paiementA.id);
    expect(tousLesVersements).toHaveLength(2);
  });

  it("rapprocherCsv propose un candidat (montant+date+référence) sans rien écrire en base", async () => {
    const locataire = await locatairesService.create({ nom: "Dupont", prenom: "Alice" });
    await bailLocatairesService.create({ bailId, locataireId: locataire.id, role: "titulaire" });

    const paiement = await paiementsService.create({
      bailId,
      type: "loyer",
      montant: "850.00",
      dateEcheance: "2026-09-01"
    });

    const csv = "Date,Montant,Libelle\n2026-09-02,850.00,VIR DUPONT LOYER SEPTEMBRE\n";
    const resultat = await paiementsService.rapprocherCsv({ contenuCsv: csv });

    expect(resultat.propositions).toHaveLength(1);
    expect(resultat.propositions[0]?.candidats).toEqual([
      { paiementId: paiement.id, criteresCorrespondants: ["montant", "date", "reference"] }
    ]);

    // Aucune écriture : le paiement reste impaye tant que la confirmation
    // (versementsService.ajouter()) n'a pas été appelée explicitement.
    const [rowEnBase] = await db.select().from(paiements).where(eq(paiements.id, paiement.id));
    expect(rowEnBase?.statut).toBe("impaye");
    expect(await versementsService.findAll(paiement.id)).toHaveLength(0);
  });

  it("rapprocherCsv matche sur le SOLDE RESTANT d'un paiement déjà partiellement réglé", async () => {
    const locataire = await locatairesService.create({ nom: "Dupont", prenom: "Alice" });
    await bailLocatairesService.create({ bailId, locataireId: locataire.id, role: "titulaire" });

    const paiement = await paiementsService.create({
      bailId,
      type: "loyer",
      montant: "800.00",
      dateEcheance: "2026-09-01"
    });
    // Premier versement de 400€ déjà enregistré (statut "partiel").
    await versementsService.ajouter({
      paiementId: paiement.id,
      montant: "400.00",
      mode: "virement",
      dateVersement: "2026-09-05"
    });

    // Une ligne CSV pour le SOLDE RESTANT (400€), pas le montant total dû
    // (800€) : doit être proposée grâce au matching sur solde restant.
    // Date proche de dateEcheance (2026-09-01), dans la tolérance par
    // défaut de proposerRapprochements (5 jours) — le critère de date
    // compare toujours à dateEcheance, pas à la date du versement précédent.
    const csv = "Date,Montant,Libelle\n2026-09-04,400.00,VIR DUPONT SOLDE\n";
    const resultat = await paiementsService.rapprocherCsv({ contenuCsv: csv });

    expect(resultat.propositions).toHaveLength(1);
    expect(resultat.propositions[0]?.candidats).toEqual([
      { paiementId: paiement.id, criteresCorrespondants: ["montant", "date", "reference"] }
    ]);
  });

  it("rapprocherCsv présente TOUS les candidats en cas d'ambiguïté entre deux baux", async () => {
    const locataireA = await locatairesService.create({ nom: "Dupont", prenom: "Alice" });
    await bailLocatairesService.create({ bailId, locataireId: locataireA.id, role: "titulaire" });
    const paiementA = await paiementsService.create({
      bailId,
      type: "loyer",
      montant: "850.00",
      dateEcheance: "2026-09-01"
    });

    // Second appartement/bail avec exactement le même montant et la même
    // échéance, mais un locataire différent.
    const sci2 = await scisService.create(userId, { nom: "SCI Paiements Test 2", regimeFiscal: "IR", adresse: "1 rue de Test", codePostal: "75001", ville: "Paris" });
    const immeuble2 = await immeublesService.create({
      sciId: sci2.id,
      nom: "Immeuble Paiements Test 2",
      adresse: "2 rue des Paiements",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartement2 = await appartementsService.create({
      immeubleId: immeuble2.id,
      numero: "2",
      type: "T2",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel",
      loyerReference: "850.00"
    });
    const bail2 = await bauxService.create({
      appartementId: appartement2.id,
      typeBail: "vide",
      dateDebut: "2026-08-01",
      jourEcheance: 5
    });
    await bauxService.activer(bail2.id);
    // Même raison que dans le beforeEach : neutraliser l'échéance
    // auto-générée par l'activation, hors sujet pour ce test.
    for (const echeanceGeneree of await paiementsService.findAll(bail2.id)) {
      await paiementsService.archive(echeanceGeneree.id);
    }
    const locataireB = await locatairesService.create({ nom: "Martin", prenom: "Bob" });
    await bailLocatairesService.create({ bailId: bail2.id, locataireId: locataireB.id, role: "titulaire" });
    const paiementB = await paiementsService.create({
      bailId: bail2.id,
      type: "loyer",
      montant: "850.00",
      dateEcheance: "2026-09-01"
    });

    const csv = "Date,Montant,Libelle\n2026-09-02,850.00,VIR MARTIN LOYER SEPTEMBRE\n";
    const resultat = await paiementsService.rapprocherCsv({ contenuCsv: csv });

    expect(resultat.propositions).toHaveLength(1);
    const candidats = resultat.propositions[0]?.candidats ?? [];
    expect(candidats).toHaveLength(2);
    const parId = Object.fromEntries(candidats.map((c) => [c.paiementId, c.criteresCorrespondants]));
    expect(parId[paiementA.id]).toEqual(["montant", "date"]);
    expect(parId[paiementB.id]).toEqual(["montant", "date", "reference"]);
  });

  it("archive un paiement, jamais supprimé, et cascade l'archivage à ses versements actifs", async () => {
    const paiement = await paiementsService.create({
      bailId,
      type: "loyer",
      montant: "850.00",
      dateEcheance: "2026-09-01"
    });
    const versement = await versementsService.ajouter({
      paiementId: paiement.id,
      montant: "850.00",
      mode: "virement",
      dateVersement: "2026-09-02"
    });

    const archive = await paiementsService.archive(paiement.id);
    expect(archive.archivedAt).not.toBeNull();

    const [rowEnBase] = await db.select().from(paiements).where(eq(paiements.id, paiement.id));
    expect(rowEnBase).toBeDefined();
    expect(rowEnBase?.archivedAt).not.toBeNull();

    const [versementEnBase] = await db.select().from(versements).where(eq(versements.id, versement.id));
    expect(versementEnBase?.archivedAt).not.toBeNull();
  });

  // Vérifie l'infrastructure de timbrage audit centralisée sur le chemin
  // financier le plus sensible du module : le recalcul de statut déclenché
  // par versementsService.ajouter() timbre bien le PAIEMENT (updated_by/
  // version), pas seulement le versement lui-même.
  it("timbre updated_by/version sur le paiement quand un versement est ajouté", async () => {
    const paiement = await paiementsService.create({
      bailId,
      type: "loyer",
      montant: "850.00",
      dateEcheance: "2026-09-01"
    });
    expect(paiement.updatedBy).toBeNull();
    expect(paiement.version).toBe(1);

    await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      versementsService.ajouter({
        paiementId: paiement.id,
        montant: "850.00",
        mode: "virement",
        dateVersement: "2026-09-02"
      })
    );

    const paiementMisAJour = await paiementsService.findById(paiement.id);
    expect(paiementMisAJour?.updatedBy).toBe(userId);
    expect(paiementMisAJour?.version).toBe(2);
  });
});
