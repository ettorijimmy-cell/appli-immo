import { randomUUID } from "crypto";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, paiements, utilisateurs, type Database } from "db";
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
import { EnregistrerPaiementDto } from "./dto/enregistrer-paiement.dto";
import { PaiementsModule } from "./paiements.module";
import { PaiementsService } from "./paiements.service";

// Vérifie le critère de complétion du Module 5 (docs/backlog.md) : importer
// un relevé CSV, voir les paiements correspondants automatiquement
// rapprochés (proposés — jamais appliqués sans confirmation), corriger
// manuellement un rapprochement incorrect. Chaque test tourne dans sa
// propre transaction annulée dans afterEach — voir
// test-utils/transactional-test.ts.
describe("Paiements — enregistrement, calcul de statut, rapprochement CSV (intégration Postgres réelle)", () => {
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
        PaiementsModule
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

    const sci = await scisService.create(userId, { nom: "SCI Paiements Test", regimeFiscal: "IR" });
    const immeuble = await immeublesService.create({
      sciId: sci.id,
      nom: "Immeuble Paiements Test",
      adresse: "1 rue des Paiements"
    });
    const appartement = await appartementsService.create({
      immeubleId: immeuble.id,
      numero: "1",
      type: "T2",
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

  it("crée un paiement impaye par défaut, sans montant reçu", async () => {
    const paiement = await paiementsService.create({
      bailId,
      type: "loyer",
      montant: "850.00",
      dateEcheance: "2026-09-01"
    });
    expect(paiement.statut).toBe("impaye");
    expect(paiement.montantPaye).toBeNull();
  });

  it("enregistrer() passe le statut à paye quand le montant reçu couvre le montant dû", async () => {
    const paiement = await paiementsService.create({
      bailId,
      type: "loyer",
      montant: "850.00",
      dateEcheance: "2026-09-01"
    });

    const enregistre = await paiementsService.enregistrer(paiement.id, {
      montantPaye: "850.00",
      mode: "virement",
      datePaiement: "2026-09-02"
    });

    expect(enregistre.statut).toBe("paye");
    expect(enregistre.mode).toBe("virement");
    expect(enregistre.datePaiement).toBe("2026-09-02");
  });

  it("enregistrer() passe le statut à partiel quand le montant reçu est inférieur au montant dû", async () => {
    const paiement = await paiementsService.create({
      bailId,
      type: "loyer",
      montant: "850.00",
      dateEcheance: "2026-09-01"
    });

    const enregistre = await paiementsService.enregistrer(paiement.id, {
      montantPaye: "400.00",
      mode: "virement",
      datePaiement: "2026-09-02"
    });

    expect(enregistre.statut).toBe("partiel");
  });

  // Reproduit exactement le chemin réel (ValidationPipe : plainToInstance
  // + validate, avant que le contrôleur n'appelle le service) plutôt que
  // d'appeler enregistrer() avec un objet déjà "propre" — sans ça, le test
  // ne verrait jamais le bug qu'il vérifie (@IsNumberString rejetait
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

    async function enregistrerViaDto(paiementId: string, montantPayeBrut: string) {
      const dto = plainToInstance(EnregistrerPaiementDto, {
        montantPaye: montantPayeBrut,
        mode: "virement",
        datePaiement: "2026-09-02"
      });
      const erreurs = await validate(dto);
      expect(erreurs).toHaveLength(0);
      return paiementsService.enregistrer(paiementId, dto);
    }

    // "850,00" simule une ligne de relevé CSV (RapprochementCsvView),
    // "850.00" simule une saisie manuelle du formulaire.
    const resultatVirgule = await enregistrerViaDto(paiementVirgule.id, "850,00");
    const resultatPoint = await enregistrerViaDto(paiementPoint.id, "850.00");

    expect(resultatVirgule.montantPaye).toBe("850.00");
    expect(resultatVirgule.montantPaye).toBe(resultatPoint.montantPaye);
    expect(resultatVirgule.statut).toBe(resultatPoint.statut);
  });

  it("update() ne peut jamais écrire montant_paye/mode/date_paiement, mais recalcule le statut si le montant change", async () => {
    const paiement = await paiementsService.create({
      bailId,
      type: "loyer",
      montant: "850.00",
      dateEcheance: "2026-09-01"
    });
    await paiementsService.enregistrer(paiement.id, {
      montantPaye: "400.00",
      mode: "virement",
      datePaiement: "2026-09-02"
    });

    // Correction du montant dû (erreur de saisie initiale) : le paiement
    // devient intégralement couvert par le montant déjà reçu, sans jamais
    // repasser par enregistrer().
    const corrige = await paiementsService.update(paiement.id, { montant: "400.00" });
    expect(corrige.statut).toBe("paye");
    expect(corrige.montantPaye).toBe("400.00");

    // update() ne porte aucun champ montant_paye/mode/date_paiement : même
    // en forçant le typage, rien ne serait écrit (voir UpdatePaiementDto).
    const dtoForce = { montant: "850.00", montantPaye: "0.00" } as unknown as Parameters<
      typeof paiementsService.update
    >[1];
    const resultat = await paiementsService.update(paiement.id, dtoForce);
    expect(resultat.montantPaye).toBe("400.00");
    expect(resultat.statut).toBe("partiel");
  });

  it("corrige un rapprochement incorrect via annulerEnregistrement puis un nouvel enregistrement", async () => {
    const paiementA = await paiementsService.create({
      bailId,
      type: "loyer",
      montant: "850.00",
      dateEcheance: "2026-09-01"
    });

    // Rapprochement incorrect : ce virement ne correspondait pas réellement
    // à ce paiement.
    await paiementsService.enregistrer(paiementA.id, {
      montantPaye: "850.00",
      mode: "virement",
      datePaiement: "2026-09-03",
      referenceRapprochement: "VIR MAUVAIS LOCATAIRE"
    });

    const annule = await paiementsService.annulerEnregistrement(paiementA.id);
    expect(annule.statut).toBe("impaye");
    expect(annule.montantPaye).toBeNull();
    expect(annule.mode).toBeNull();
    expect(annule.datePaiement).toBeNull();
    expect(annule.referenceRapprochement).toBeNull();

    const corrige = await paiementsService.enregistrer(paiementA.id, {
      montantPaye: "850.00",
      mode: "virement",
      datePaiement: "2026-09-03",
      referenceRapprochement: "VIR BON LOCATAIRE"
    });
    expect(corrige.statut).toBe("paye");
    expect(corrige.referenceRapprochement).toBe("VIR BON LOCATAIRE");
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
    // (enregistrer()) n'a pas été appelée explicitement.
    const [rowEnBase] = await db.select().from(paiements).where(eq(paiements.id, paiement.id));
    expect(rowEnBase?.statut).toBe("impaye");
    expect(rowEnBase?.montantPaye).toBeNull();
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
    const sci2 = await scisService.create(userId, { nom: "SCI Paiements Test 2", regimeFiscal: "IR" });
    const immeuble2 = await immeublesService.create({
      sciId: sci2.id,
      nom: "Immeuble Paiements Test 2",
      adresse: "2 rue des Paiements"
    });
    const appartement2 = await appartementsService.create({
      immeubleId: immeuble2.id,
      numero: "2",
      type: "T2",
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

  it("archive un paiement, jamais supprimé", async () => {
    const paiement = await paiementsService.create({
      bailId,
      type: "loyer",
      montant: "850.00",
      dateEcheance: "2026-09-01"
    });

    const archive = await paiementsService.archive(paiement.id);
    expect(archive.archivedAt).not.toBeNull();

    const [rowEnBase] = await db.select().from(paiements).where(eq(paiements.id, paiement.id));
    expect(rowEnBase).toBeDefined();
    expect(rowEnBase?.archivedAt).not.toBeNull();
  });

  // Vérifie l'infrastructure de timbrage audit centralisée sur le chemin
  // financier le plus sensible du module (enregistrer() est la seule voie
  // d'écriture de montant_paye) — voir aussi patrimoine.integration.spec.ts
  // pour le cas simple et locataires-baux.integration.spec.ts pour le cas
  // transactionnel.
  it("timbre updated_by/version sur enregistrer(), le chemin d'écriture financier", async () => {
    const paiement = await paiementsService.create({
      bailId,
      type: "loyer",
      montant: "850.00",
      dateEcheance: "2026-09-01"
    });
    expect(paiement.updatedBy).toBeNull();
    expect(paiement.version).toBe(1);

    const enregistre = await requestContextService.executerAvecContexte(
      { utilisateurId: userId },
      () =>
        paiementsService.enregistrer(paiement.id, {
          montantPaye: "850.00",
          mode: "virement",
          datePaiement: "2026-09-02"
        })
    );
    expect(enregistre.updatedBy).toBe(userId);
    expect(enregistre.version).toBe(2);
  });
});
