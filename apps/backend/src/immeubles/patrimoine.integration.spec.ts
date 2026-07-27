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
  utilisateurs,
  type Database
} from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuthModule } from "../auth/auth.module";
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
  let db: Database;
  let userId: string;

  beforeEach(async () => {
    db = await begin();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
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
    const sci = await scisService.create(userId, { nom: "SCI Patrimoine Test", regimeFiscal: "IR" });

    const immeuble = await immeublesService.create({
      sciId: sci.id,
      nom: "Immeuble Test",
      adresse: "1 rue de Test"
    });
    expect(immeuble.sciId).toBe(sci.id);

    const immeublesForSci = await immeublesService.findAll(sci.id);
    expect(immeublesForSci).toHaveLength(1);
    expect(immeublesForSci[0]?.id).toBe(immeuble.id);

    const appartement = await appartementsService.create({
      immeubleId: immeuble.id,
      numero: "12",
      type: "T2"
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
    const sci = await scisService.create(userId, { nom: "SCI Archive Test", regimeFiscal: "IS" });
    const immeuble = await immeublesService.create({
      sciId: sci.id,
      nom: "Immeuble à modifier",
      adresse: "2 rue de Test"
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
    const sci = await scisService.create(userId, { nom: "SCI Appt Travaux", regimeFiscal: "IR" });
    const immeuble = await immeublesService.create({
      sciId: sci.id,
      nom: "Immeuble Appt Travaux",
      adresse: "5 rue de Test"
    });
    const appartement = await appartementsService.create({
      immeubleId: immeuble.id,
      numero: "5",
      type: "T2"
    });
    expect(appartement.statut).toBe("vacant");

    const enTravaux = await appartementsService.update(appartement.id, { statut: "travaux" });
    expect(enTravaux.statut).toBe("travaux");

    const revenuVacant = await appartementsService.update(appartement.id, { statut: "vacant" });
    expect(revenuVacant.statut).toBe("vacant");
  });

  it("un appartement archivé passe par statut='archive', jamais supprimé", async () => {
    const sci = await scisService.create(userId, { nom: "SCI Appt Archive", regimeFiscal: "IR" });
    const immeuble = await immeublesService.create({
      sciId: sci.id,
      nom: "Immeuble Appt Archive",
      adresse: "3 rue de Test"
    });
    const appartement = await appartementsService.create({
      immeubleId: immeuble.id,
      numero: "3",
      type: "T1"
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
    const sci = await scisService.create(userId, { nom: "SCI Equip Archive", regimeFiscal: "IR" });
    const immeuble = await immeublesService.create({
      sciId: sci.id,
      nom: "Immeuble Equip Archive",
      adresse: "4 rue de Test"
    });
    const appartement = await appartementsService.create({
      immeubleId: immeuble.id,
      numero: "4",
      type: "T3"
    });
    const equipement = await equipementsService.create({
      appartementId: appartement.id,
      type: "ballon_eau_chaude"
    });

    await equipementsService.archive(equipement.id);

    const [rowEnBase] = await db.select().from(equipements).where(eq(equipements.id, equipement.id));
    expect(rowEnBase?.archivedAt).not.toBeNull();
  });
});
