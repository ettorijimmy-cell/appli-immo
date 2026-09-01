import { randomUUID } from "crypto";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  appartements,
  bien as bienTable,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  equipements,
  immeublesLegacy,
  organisations,
  scis,
  utilisateurs,
  type Database
} from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuthModule } from "../auth/auth.module";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { EquipementsModule } from "../equipements/equipements.module";
import { EquipementsService } from "../equipements/equipements.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { ImmeublesModule } from "./immeubles.module";
import { ImmeublesService } from "./immeubles.service";

// Vérifie le critère de complétion du Module 2 (docs/backlog.md) :
// parcourir la hiérarchie SCI -> Bien -> Appartement -> Équipement, plus
// l'archivage (jamais de suppression physique) pour les entités
// concernées. Migré le 2026-08-26 (Étape 4, migration bien,
// docs/backlog.md) : AppartementsService ne s'appuie plus sur immeubleId,
// toute création d'appartement passe désormais par un bien (BienService).
// ImmeublesService passé en lecture seule le 2026-08-27 (table immeubles
// renommée immeubles_legacy, décision utilisateur, docs/backlog.md) :
// findAll()/findById() couverts ci-dessous, indépendamment de la chaîne
// appartement. Tourne contre un vrai Postgres — voir
// scis.integration.spec.ts pour le fonctionnement général.
//
// Chaque test tourne dans sa propre transaction annulée dans afterEach (voir
// test-utils/transactional-test.ts), setup (organisation + utilisateur)
// compris.
describe("Patrimoine — hiérarchie SCI -> Bien -> Appartement -> Équipement (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let scisService: ScisService;
  let immeublesService: ImmeublesService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let equipementsService: EquipementsService;
  let requestContextService: RequestContextService;
  let db: Database;
  let userId: string;
  let organisationId: string;

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
        BienModule,
        AppartementsModule,
        EquipementsModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    immeublesService = moduleRef.get(ImmeublesService);
    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    equipementsService = moduleRef.get(EquipementsService);
    requestContextService = moduleRef.get(RequestContextService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Patrimoine Intégration" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }

    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `patrimoine-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Patrimoine",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    userId = user.id;
    organisationId = organisation.id;
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  it("parcourt la hiérarchie complète SCI -> Bien -> Appartement -> Équipement", async () => {
    const sci = await scisService.create(userId, { nom: "SCI Patrimoine Test", regimeFiscal: "IR", adresse: "1 rue de Test", codePostal: "75001", ville: "Paris" });

    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Test",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    expect(bien.sciId).toBe(sci.id);
    expect(bien.organisationId).toBe(organisationId);

    const biensForSci = await bienService.findAll(sci.id);
    expect(biensForSci).toHaveLength(1);
    expect(biensForSci[0]?.id).toBe(bien.id);

    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: "12",
      type: "T2",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    expect(appartement.bienId).toBe(bien.id);
    expect(appartement.statut).toBe("vacant");

    const appartementsForBien = await appartementsService.findAll(bien.id);
    expect(appartementsForBien).toHaveLength(1);
    expect(appartementsForBien[0]?.id).toBe(appartement.id);

    const equipement = await equipementsService.create({
      appartementId: appartement.id,
      type: "chaudiere",
      dateDernierEntretien: "2026-01-15"
    });
    expect(equipement.appartementId).toBe(appartement.id);

    const equipementsForAppartement = await equipementsService.findAll(appartement.id);
    expect(equipementsForAppartement).toHaveLength(1);
    expect(equipementsForAppartement[0]?.id).toBe(equipement.id);
  });

  it("met à jour et archive un bien de type immeuble sans le supprimer", async () => {
    const sci = await scisService.create(userId, { nom: "SCI Archive Test", regimeFiscal: "IS", adresse: "1 rue de Test", codePostal: "75001", ville: "Paris" });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble à modifier",
      adresse: "2 rue de Test",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });

    const updated = await bienService.update(bien.id, { ville: "Paris" });
    expect(updated.ville).toBe("Paris");
    expect(updated.statut).toBe("actif");

    const archived = await bienService.archive(bien.id);
    expect(archived.statut).toBe("archive");
    expect(archived.archivedAt).not.toBeNull();
  });

  it("crée un bien de type maison en nom propre, sans SCI ni bien_immeuble_detail", async () => {
    const bien = await bienService.create(userId, {
      type: "maison",
      proprietaireType: "personne_physique",
      nomProprietaire: "Jean Dupont",
      adresse: "10 rue de la Maison",
      codePostal: "75001",
      ville: "Paris"
    });
    expect(bien.sciId).toBeNull();
    expect(bien.proprietaireType).toBe("personne_physique");
    expect(bien.nomProprietaire).toBe("Jean Dupont");
    // Dérivés automatiquement pour type='maison' (2026-08-26) — jamais
    // null, aucune saisie possible.
    expect(bien.typeHabitat).toBe("individuel");
    expect(bien.regimeJuridique).toBe("mono_propriete");

    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: "unique",
      type: "T4",
      nombrePiecesPrincipales: 5,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    expect(appartement.bienId).toBe(bien.id);
  });

  it("rejette un bien de type immeuble sans sciId ni personne_physique cohérente", async () => {
    await expect(
      bienService.create(userId, {
        type: "immeuble",
        proprietaireType: "sci",
        // sciId manquant volontairement
        nom: "Immeuble Invalide",
        adresse: "1 rue de Test",
        codePostal: "75001",
        ville: "Paris",
        typeHabitat: "collectif",
        regimeJuridique: "copropriete"
      })
    ).rejects.toThrow();
  });

  it("permet le passage manuel vacant -> travaux, indépendamment de tout bail", async () => {
    const sci = await scisService.create(userId, { nom: "SCI Appt Travaux", regimeFiscal: "IR", adresse: "1 rue de Test", codePostal: "75001", ville: "Paris" });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Appt Travaux",
      adresse: "5 rue de Test",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: "5",
      type: "T2",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    expect(appartement.statut).toBe("vacant");

    const enTravaux = await appartementsService.update(appartement.id, { statut: "travaux" });
    expect(enTravaux.statut).toBe("travaux");

    const revenuVacant = await appartementsService.update(appartement.id, { statut: "vacant" });
    expect(revenuVacant.statut).toBe("vacant");
  });

  it("un appartement archivé passe par statut='archive', jamais supprimé", async () => {
    const sci = await scisService.create(userId, { nom: "SCI Appt Archive", regimeFiscal: "IR", adresse: "1 rue de Test", codePostal: "75001", ville: "Paris" });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Appt Archive",
      adresse: "3 rue de Test",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: "3",
      type: "T1",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });

    await appartementsService.archive(appartement.id);

    const [rowEnBase] = await db
      .select()
      .from(appartements)
      .where(eq(appartements.id, appartement.id));
    expect(rowEnBase?.statut).toBe("archive");
    expect(rowEnBase?.archivedAt).not.toBeNull();
  });

  it("un équipement archivé n'a pas de statut dédié mais garde archivedAt", async () => {
    const sci = await scisService.create(userId, { nom: "SCI Equip Archive", regimeFiscal: "IR", adresse: "1 rue de Test", codePostal: "75001", ville: "Paris" });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Equip Archive",
      adresse: "4 rue de Test",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: "4",
      type: "T3",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    const equipement = await equipementsService.create({
      appartementId: appartement.id,
      type: "ballon_eau_chaude"
    });

    await equipementsService.archive(equipement.id);

    const [rowEnBase] = await db.select().from(equipements).where(eq(equipements.id, equipement.id));
    expect(rowEnBase?.archivedAt).not.toBeNull();
  });

  // Non-régression de la migration "Édition d'un bail" (docs/backlog.md) :
  // les nouveaux champs nullables (adresse SCI, type_habitat/regime_
  // juridique/annee_construction, identifiant_fiscal/nombre_
  // pieces_principales/mode_chauffage/mode_eau_chaude appartement) ne
  // doivent rien casser sur le fonctionnement existant — une fiche créée
  // avant l'introduction de ces champs (ou avant qu'ils deviennent
  // obligatoires à la création, voir docs/data-dictionary.md) doit rester
  // pleinement consultable et modifiable, avec ces colonnes à NULL plutôt
  // que de bloquer quoi que ce soit. `CreateSciDto`/`CreateBienDto`/
  // `CreateAppartementDto` rendent désormais ces champs obligatoires pour
  // toute nouvelle fiche — on simule donc ici une fiche pré-existante via
  // une écriture directe en base après création, plutôt que par le DTO qui
  // ne permet plus cet état pour une fiche neuve.
  it("SCI/bien/appartement créés et modifiés à l'ancienne restent pleinement fonctionnels après la migration des champs d'édition de bail", async () => {
    const sci = await scisService.create(userId, {
      nom: "SCI Migration Bail",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    await db.update(scis).set({ adresse: null, codePostal: null, ville: null }).where(eq(scis.id, sci.id));
    const sciRelue = await scisService.findById(sci.id);
    expect(sciRelue?.adresse).toBeNull();
    expect(sciRelue?.nomGerant).toBeNull();

    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Migration Bail",
      adresse: "7 rue de Test",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    await db
      .update(bienTable)
      .set({ typeHabitat: null, regimeJuridique: null })
      .where(eq(bienTable.id, bien.id));
    const bienRelu = await bienService.findById(bien.id);
    expect(bienRelu?.typeHabitat).toBeNull();
    expect(bienRelu?.regimeJuridique).toBeNull();
    expect(bienRelu?.anneeConstruction).toBeNull();

    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: "7",
      type: "T2",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    await db
      .update(appartements)
      .set({ nombrePiecesPrincipales: null, modeChauffage: null, modeEauChaude: null })
      .where(eq(appartements.id, appartement.id));
    const appartementRelu = await appartementsService.findById(appartement.id);
    expect(appartementRelu?.nombrePiecesPrincipales).toBeNull();
    expect(appartementRelu?.modeChauffage).toBeNull();
    expect(appartementRelu?.modeEauChaude).toBeNull();

    // Toujours consultable...
    expect(appartementRelu?.numero).toBe("7");

    // ...et toujours modifiable, sur un champ préexistant, sans jamais
    // toucher aux nouveaux champs.
    const misAJour = await appartementsService.update(appartement.id, { surface: "42.50" });
    expect(misAJour.surface).toBe("42.50");

    const bienMisAJour = await bienService.update(bien.id, { ville: "Marseille" });
    expect(bienMisAJour.ville).toBe("Marseille");
  });

  it("findAll()/findById()/update() ne renvoient jamais identifiant_fiscal (donnée fiscale nominative, jamais exposée via l'API)", async () => {
    const sci = await scisService.create(userId, {
      nom: "SCI Identifiant Fiscal",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Identifiant Fiscal",
      adresse: "9 rue de Test",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const [appartement] = await db
      .insert(appartements)
      .values({
        bienId: bien.id,
        numero: "9",
        type: "T2",
        identifiantFiscal: "MARQUEUR-IDENTIFIANT-FISCAL-TEST",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel"
      })
      .returning();
    if (!appartement) {
      throw new Error("Échec de la création de l'appartement de test");
    }

    const relu = await appartementsService.findById(appartement.id);
    expect(relu).not.toHaveProperty("identifiantFiscal");

    const [depuisFindAll] = await appartementsService.findAll(bien.id);
    expect(depuisFindAll).not.toHaveProperty("identifiantFiscal");

    const misAJour = await appartementsService.update(appartement.id, { surface: "30.00" });
    expect(misAJour).not.toHaveProperty("identifiantFiscal");
  });

  // Vérifie l'infrastructure de timbrage audit centralisée (docs/backlog.md,
  // entrée "version/updated_by jamais posés") : quand un utilisateur est
  // présent dans le contexte requête (simulé ici via
  // RequestContextService.executerAvecContexte, normalement posé par
  // UserContextInterceptor pour chaque requête HTTP réelle),
  // mettreAJourAvecAudit doit le reporter sur updated_by et incrémenter
  // version — sans qu'AppartementsService/BienService y pensent. La
  // couverture sur ImmeublesService a été retirée le 2026-08-27 en même
  // temps que ses méthodes update()/archive() (table immeubles renommée
  // immeubles_legacy, lecture seule — décision utilisateur, docs/backlog.md) ;
  // BienService (table bien) suffit à couvrir mettreAJourAvecAudit.
  it("timbre updated_by et incrémente version quand un utilisateur est présent dans le contexte requête", async () => {
    const sci = await scisService.create(userId, { nom: "SCI Audit Stamp", regimeFiscal: "IR", adresse: "1 rue de Test", codePostal: "75001", ville: "Paris" });

    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Bien Audit Stamp",
      adresse: "8 rue de Test",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    expect(bien.version).toBe(1);
    expect(bien.updatedBy).toBeNull();

    const bienMisAJour = await requestContextService.executerAvecContexte(
      { utilisateurId: userId },
      () => bienService.update(bien.id, { ville: "Lyon" })
    );
    expect(bienMisAJour.updatedBy).toBe(userId);
    expect(bienMisAJour.version).toBe(2);

    // Hors contexte (comme tous les autres tests de ce fichier) :
    // updated_by reste null plutôt que de faire échouer l'écriture — pas de
    // contexte requête possible en dehors d'une vraie requête HTTP (scripts,
    // tests directs).
    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: "6",
      type: "T2",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    const misAJourSansContexte = await appartementsService.update(appartement.id, { statut: "travaux" });
    expect(misAJourSansContexte.updatedBy).toBeNull();
    expect(misAJourSansContexte.version).toBe(2);
  });

  // ImmeublesService lecture seule (2026-08-27, table renommée
  // immeubles_legacy) : plus de create() pour peupler le fixture, insertion
  // directe en base — simule une ligne historique, exactement ce que
  // findAll()/findById() doivent encore pouvoir résoudre.
  it("ImmeublesService reste capable de lire une ligne existante (findAll/findById) malgré le retrait de create/update/archive", async () => {
    const sci = await scisService.create(userId, {
      nom: "SCI Immeuble Lecture Seule",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const [immeubleExistant] = await db
      .insert(immeublesLegacy)
      .values({
        sciId: sci.id,
        nom: "Immeuble Historique",
        adresse: "13 rue de Test",
        typeHabitat: "collectif",
        regimeJuridique: "copropriete"
      })
      .returning();
    if (!immeubleExistant) {
      throw new Error("Échec de l'insertion de l'immeuble de test");
    }

    const trouve = await immeublesService.findById(immeubleExistant.id);
    expect(trouve?.nom).toBe("Immeuble Historique");

    const listeParSci = await immeublesService.findAll(sci.id);
    expect(listeParSci.map((i) => i.id)).toContain(immeubleExistant.id);
  });

  // Audit champs conditionnels par type de bien (docs/backlog.md,
  // 2026-08-27) : type/nombrePiecesPrincipales/modeChauffage/modeEauChaude/
  // typeEnergie sont des mentions du contrat-type résidentiel (décret
  // n° 2015-587), sans objet pour un parking/bureau/local_commercial.
  it("crée l'appartement unique d'un bien non résidentiel (parking) sans aucun champ d'habitation", async () => {
    const bien = await bienService.create(userId, {
      type: "parking",
      proprietaireType: "personne_physique",
      nomProprietaire: "Jean Dupont",
      adresse: "1 avenue du Parking",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "individuel",
      regimeJuridique: "mono_propriete"
    });
    const appartement = await appartementsService.create({ bienId: bien.id, numero: "P1" });
    expect(appartement.type).toBeNull();
    expect(appartement.nombrePiecesPrincipales).toBeNull();
    expect(appartement.modeChauffage).toBeNull();
    expect(appartement.modeEauChaude).toBeNull();
    expect(appartement.typeEnergie).toBeNull();
  });

  it("rejette la création d'un appartement pour un bien non résidentiel si un champ d'habitation est fourni", async () => {
    const bien = await bienService.create(userId, {
      type: "parking",
      proprietaireType: "personne_physique",
      nomProprietaire: "Jean Dupont",
      adresse: "2 avenue du Parking",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "individuel",
      regimeJuridique: "mono_propriete"
    });
    await expect(
      appartementsService.create({ bienId: bien.id, numero: "P2", type: "T2" })
    ).rejects.toThrow(/sans objet pour un bien non résidentiel/);
  });

  it("rejette la mise à jour d'un appartement non résidentiel si un champ d'habitation est fourni, même typeEnergie seul", async () => {
    const bien = await bienService.create(userId, {
      type: "bureau",
      proprietaireType: "personne_physique",
      nomProprietaire: "Jean Dupont",
      adresse: "1 rue du Bureau",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "individuel",
      regimeJuridique: "mono_propriete"
    });
    const appartement = await appartementsService.create({ bienId: bien.id, numero: "B1" });

    await expect(appartementsService.update(appartement.id, { typeEnergie: "electrique" })).rejects.toThrow(
      /sans objet pour un bien non résidentiel/
    );
    await expect(appartementsService.update(appartement.id, { modeChauffage: "individuel" })).rejects.toThrow(
      /sans objet pour un bien non résidentiel/
    );
    // Un champ hors liste (surface) reste modifiable normalement.
    const misAJour = await appartementsService.update(appartement.id, { surface: "12.00" });
    expect(misAJour.surface).toBe("12.00");
  });

  it("rejette la création d'un appartement résidentiel auquel il manque un champ obligatoire", async () => {
    const sci = await scisService.create(userId, {
      nom: "SCI Champs Manquants",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Champs Manquants",
      adresse: "11 rue de Test",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    await expect(
      appartementsService.create({ bienId: bien.id, numero: "11", type: "T2", modeChauffage: "individuel" })
    ).rejects.toThrow(/obligatoires manquants pour un appartement résidentiel/);
  });

  it("typeEnergie reste settable pour un appartement résidentiel (correction du bug : aucun DTO ne l'exposait avant)", async () => {
    const sci = await scisService.create(userId, {
      nom: "SCI Type Energie",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Type Energie",
      adresse: "12 rue de Test",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: "12",
      type: "T2",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    expect(appartement.typeEnergie).toBeNull();

    const misAJour = await appartementsService.update(appartement.id, { typeEnergie: "gaz" });
    expect(misAJour.typeEnergie).toBe("gaz");
  });
});
