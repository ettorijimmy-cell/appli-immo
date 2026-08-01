import { randomUUID } from "crypto";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  appartements,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  equipements,
  immeubles,
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
// parcourir la hiérarchie SCI -> immeuble -> appartement, plus l'archivage
// (jamais de suppression physique) pour les trois entités. Tourne contre
// un vrai Postgres — voir scis.integration.spec.ts pour le fonctionnement
// général.
//
// Chaque test tourne dans sa propre transaction annulée dans afterEach (voir
// test-utils/transactional-test.ts), setup (organisation + utilisateur)
// compris.
describe("Patrimoine — hiérarchie SCI -> Immeuble -> Appartement -> Équipement (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let scisService: ScisService;
  let immeublesService: ImmeublesService;
  let appartementsService: AppartementsService;
  let equipementsService: EquipementsService;
  let requestContextService: RequestContextService;
  let db: Database;
  let userId: string;

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
        EquipementsModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    immeublesService = moduleRef.get(ImmeublesService);
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
  });

  afterEach(async () => {
    await moduleRef.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  it("parcourt la hiérarchie complète SCI -> Immeuble -> Appartement -> Équipement", async () => {
    const sci = await scisService.create(userId, { nom: "SCI Patrimoine Test", regimeFiscal: "IR", adresse: "1 rue de Test", codePostal: "75001", ville: "Paris" });

    const immeuble = await immeublesService.create({
      sciId: sci.id,
      nom: "Immeuble Test",
      adresse: "1 rue de Test",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    expect(immeuble.sciId).toBe(sci.id);

    const immeublesForSci = await immeublesService.findAll(sci.id);
    expect(immeublesForSci).toHaveLength(1);
    expect(immeublesForSci[0]?.id).toBe(immeuble.id);

    const appartement = await appartementsService.create({
      immeubleId: immeuble.id,
      numero: "12",
      type: "T2",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    expect(appartement.immeubleId).toBe(immeuble.id);
    expect(appartement.statut).toBe("vacant");

    const appartementsForImmeuble = await appartementsService.findAll(immeuble.id);
    expect(appartementsForImmeuble).toHaveLength(1);
    expect(appartementsForImmeuble[0]?.id).toBe(appartement.id);

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

  it("met à jour et archive un immeuble sans le supprimer", async () => {
    const sci = await scisService.create(userId, { nom: "SCI Archive Test", regimeFiscal: "IS", adresse: "1 rue de Test", codePostal: "75001", ville: "Paris" });
    const immeuble = await immeublesService.create({
      sciId: sci.id,
      nom: "Immeuble à modifier",
      adresse: "2 rue de Test",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });

    const updated = await immeublesService.update(immeuble.id, { ville: "Paris" });
    expect(updated.ville).toBe("Paris");
    expect(updated.statut).toBe("actif");

    const archived = await immeublesService.archive(immeuble.id);
    expect(archived.statut).toBe("archive");
    expect(archived.archivedAt).not.toBeNull();

    // Jamais de suppression physique : la ligne existe toujours.
    const [rowEnBase] = await db.select().from(immeubles).where(eq(immeubles.id, immeuble.id));
    expect(rowEnBase).toBeDefined();
    expect(rowEnBase?.statut).toBe("archive");
  });

  it("permet le passage manuel vacant -> travaux, indépendamment de tout bail", async () => {
    const sci = await scisService.create(userId, { nom: "SCI Appt Travaux", regimeFiscal: "IR", adresse: "1 rue de Test", codePostal: "75001", ville: "Paris" });
    const immeuble = await immeublesService.create({
      sciId: sci.id,
      nom: "Immeuble Appt Travaux",
      adresse: "5 rue de Test",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartement = await appartementsService.create({
      immeubleId: immeuble.id,
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
    const immeuble = await immeublesService.create({
      sciId: sci.id,
      nom: "Immeuble Appt Archive",
      adresse: "3 rue de Test",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartement = await appartementsService.create({
      immeubleId: immeuble.id,
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
    const immeuble = await immeublesService.create({
      sciId: sci.id,
      nom: "Immeuble Equip Archive",
      adresse: "4 rue de Test",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartement = await appartementsService.create({
      immeubleId: immeuble.id,
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
  // juridique/annee_construction immeuble, identifiant_fiscal/nombre_
  // pieces_principales/mode_chauffage/mode_eau_chaude appartement) ne
  // doivent rien casser sur le fonctionnement existant — une fiche créée
  // avant l'introduction de ces champs (ou avant qu'ils deviennent
  // obligatoires à la création, voir docs/data-dictionary.md) doit rester
  // pleinement consultable et modifiable, avec ces colonnes à NULL plutôt
  // que de bloquer quoi que ce soit. `CreateSciDto`/`CreateImmeubleDto`/
  // `CreateAppartementDto` rendent désormais ces champs obligatoires pour
  // toute nouvelle fiche — on simule donc ici une fiche pré-existante via
  // une écriture directe en base après création, plutôt que par le DTO qui
  // ne permet plus cet état pour une fiche neuve.
  it("SCI/immeuble/appartement créés et modifiés à l'ancienne restent pleinement fonctionnels après la migration des champs d'édition de bail", async () => {
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

    const immeuble = await immeublesService.create({
      sciId: sci.id,
      nom: "Immeuble Migration Bail",
      adresse: "7 rue de Test",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    await db
      .update(immeubles)
      .set({ typeHabitat: null, regimeJuridique: null })
      .where(eq(immeubles.id, immeuble.id));
    const immeubleRelu = await immeublesService.findById(immeuble.id);
    expect(immeubleRelu?.typeHabitat).toBeNull();
    expect(immeubleRelu?.regimeJuridique).toBeNull();
    expect(immeubleRelu?.anneeConstruction).toBeNull();

    const appartement = await appartementsService.create({
      immeubleId: immeuble.id,
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
    expect(appartementRelu?.identifiantFiscal).toBeNull();
    expect(appartementRelu?.nombrePiecesPrincipales).toBeNull();
    expect(appartementRelu?.modeChauffage).toBeNull();
    expect(appartementRelu?.modeEauChaude).toBeNull();

    // Toujours consultable...
    expect(appartementRelu?.numero).toBe("7");

    // ...et toujours modifiable, sur un champ préexistant, sans jamais
    // toucher aux nouveaux champs.
    const misAJour = await appartementsService.update(appartement.id, { surface: "42.50" });
    expect(misAJour.surface).toBe("42.50");
    expect(misAJour.identifiantFiscal).toBeNull();

    const immeubleMisAJour = await immeublesService.update(immeuble.id, { ville: "Marseille" });
    expect(immeubleMisAJour.ville).toBe("Marseille");
    expect(immeubleMisAJour.typeHabitat).toBeNull();
  });

  // Vérifie l'infrastructure de timbrage audit centralisée (docs/backlog.md,
  // entrée "version/updated_by jamais posés") : quand un utilisateur est
  // présent dans le contexte requête (simulé ici via
  // RequestContextService.executerAvecContexte, normalement posé par
  // UserContextInterceptor pour chaque requête HTTP réelle),
  // mettreAJourAvecAudit doit le reporter sur updated_by et incrémenter
  // version — sans qu'AppartementsService/ImmeublesService y pensent.
  it("timbre updated_by et incrémente version quand un utilisateur est présent dans le contexte requête", async () => {
    const sci = await scisService.create(userId, { nom: "SCI Audit Stamp", regimeFiscal: "IR", adresse: "1 rue de Test", codePostal: "75001", ville: "Paris" });
    const immeuble = await immeublesService.create({
      sciId: sci.id,
      nom: "Immeuble Audit Stamp",
      adresse: "6 rue de Test",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    expect(immeuble.version).toBe(1);
    expect(immeuble.updatedBy).toBeNull();

    const misAJour = await requestContextService.executerAvecContexte(
      { utilisateurId: userId },
      () => immeublesService.update(immeuble.id, { ville: "Lyon" })
    );
    expect(misAJour.updatedBy).toBe(userId);
    expect(misAJour.version).toBe(2);

    const archive = await requestContextService.executerAvecContexte(
      { utilisateurId: userId },
      () => immeublesService.archive(immeuble.id)
    );
    expect(archive.updatedBy).toBe(userId);
    expect(archive.version).toBe(3);

    // Hors contexte (comme tous les autres tests de ce fichier) :
    // updated_by reste null plutôt que de faire échouer l'écriture — pas de
    // contexte requête possible en dehors d'une vraie requête HTTP (scripts,
    // tests directs).
    const appartement = await appartementsService.create({
      immeubleId: immeuble.id,
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
});
