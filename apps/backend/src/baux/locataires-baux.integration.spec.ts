import { randomUUID } from "crypto";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { appartements, baux, createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, utilisateurs, type Database } from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuthModule } from "../auth/auth.module";
import { BailLocatairesModule } from "../bail-locataires/bail-locataires.module";
import { BailLocatairesService } from "../bail-locataires/bail-locataires.service";
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
  let db: Database;
  let userId: string;
  let appartementId: string;

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
      dateDebut: "2026-08-01"
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
    const bailA = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-08-01" });
    await bauxService.activer(bailA.id);

    const bailB = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-09-01" });
    await expect(bauxService.activer(bailB.id)).rejects.toThrow(/déjà actif ou en préavis/i);

    const bailBApresEchec = await bauxService.findById(bailB.id);
    expect(bailBApresEchec?.statut).toBe("brouillon");
  });

  it("refuse d'activer un second bail même si le statut appartement a été remis à vacant manuellement pendant que le premier est actif", async () => {
    const bailA = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-08-01" });
    await bauxService.activer(bailA.id);

    // Correction manuelle (Module 2) qui remet l'appartement à vacant alors
    // que bailA est toujours réellement actif dessus — ne doit jamais
    // permettre l'activation d'un second bail en s'appuyant uniquement sur
    // ce champ miroir.
    await appartementsService.update(appartementId, { statut: "vacant" });

    const bailB = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-09-01" });
    await expect(bauxService.activer(bailB.id)).rejects.toThrow(/déjà actif ou en préavis/i);

    const bailBApresEchec = await bauxService.findById(bailB.id);
    expect(bailBApresEchec?.statut).toBe("brouillon");
    const bailAInchange = await bauxService.findById(bailA.id);
    expect(bailAInchange?.statut).toBe("actif");
  });

  it("refuse d'activer un bail déjà actif (pas de double activation)", async () => {
    const bail = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-08-01" });
    await bauxService.activer(bail.id);

    await expect(bauxService.activer(bail.id)).rejects.toThrow(/brouillon/i);
  });

  it("résilie un bail actif et repasse l'appartement à vacant", async () => {
    const bail = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-08-01" });
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
    const bail = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-08-01" });
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
    const bail = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-08-01" });

    await expect(bauxService.resilier(bail.id, {})).rejects.toThrow(/actif ou en préavis/i);
  });

  it("archive un bail résilié, jamais supprimé, et refuse d'archiver un bail encore actif", async () => {
    const bailActif = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-08-01" });
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
    const bail = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-08-01" });

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
    const bail = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-08-01" });

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
});
