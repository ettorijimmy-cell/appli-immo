import { randomUUID } from "crypto";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  appartements,
  bailLocataires,
  baux,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  locataires,
  organisations,
  paiements,
  utilisateurs,
  type Database
} from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuthModule } from "../auth/auth.module";
import { BailLocatairesModule } from "../bail-locataires/bail-locataires.module";
import { BailLocatairesService } from "../bail-locataires/bail-locataires.service";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { dateDuJourParis } from "../common/date-paris";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { BauxModule } from "./baux.module";
import { BauxService } from "./baux.service";

// Refus des archivages et résiliations qui cassent des données (chantier
// archivage, décisions 4 et 16 du 2026-11-12/13) : pour chaque refus, le
// cas autorisé juste à côté, et le contrôle d'appartenance (404) toujours
// avant le refus métier (409) pour une autre organisation.
const MESSAGE_APPARTEMENT =
  "Cet appartement a un bail actif ou en préavis. Résiliez d'abord ce bail, puis archivez l'appartement.";
const MESSAGE_LOCATAIRE =
  "Ce locataire est encore rattaché à un bail actif ou en préavis. Retirez-le de ce bail, ou résiliez le bail, avant de l'archiver.";
const MESSAGE_DERNIER_LOCATAIRE =
  "C'est le dernier locataire de ce bail actif ou en préavis. Résiliez le bail plutôt que de le retirer.";
const MESSAGE_DATE_FUTURE = "Résiliez le bail à la date de départ ou après.";

describe("Refus des archivages et résiliations qui cassent des données (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let appartementsService: AppartementsService;
  let locatairesService: LocatairesService;
  let bauxService: BauxService;
  let bailLocatairesService: BailLocatairesService;
  let requestContextService: RequestContextService;
  let db: Database;
  let userId: string;
  let organisationId: string;
  let autreOrganisationId: string;
  let appartementId: string;

  const dansMonOrganisation = <T>(fn: () => Promise<T>): Promise<T> =>
    requestContextService.executerAvecContexte({ utilisateurId: userId, organisationId }, fn);
  const dansUneAutreOrganisation = <T>(fn: () => Promise<T>): Promise<T> =>
    requestContextService.executerAvecContexte({ utilisateurId: userId, organisationId: autreOrganisationId }, fn);

  // Date passée par rapport à aujourd'hui (dateDebut des baux de test).
  const DATE_DEBUT = "2026-08-01";

  async function bailActifAvecLocataires(noms: string[]) {
    const bail = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: DATE_DEBUT, jourEcheance: 5 });
    const liens = [];
    const ids = [];
    for (const [index, nom] of noms.entries()) {
      const locataire = await locatairesService.create(userId, { nom, prenom: "Test" });
      ids.push(locataire.id);
      liens.push(
        await bailLocatairesService.create({
          bailId: bail.id,
          locataireId: locataire.id,
          role: index === 0 ? "titulaire" : "colocataire"
        })
      );
    }
    await bauxService.activer(bail.id);
    return { bailId: bail.id, liens, locataireIds: ids };
  }

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
        BienModule,
        AppartementsModule,
        LocatairesModule,
        BauxModule,
        BailLocatairesModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    const scisService = moduleRef.get(ScisService);
    const bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    locatairesService = moduleRef.get(LocatairesService);
    bauxService = moduleRef.get(BauxService);
    bailLocatairesService = moduleRef.get(BailLocatairesService);
    requestContextService = moduleRef.get(RequestContextService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Refus Archivage" })
      .returning();
    const [autreOrganisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Autre Organisation Refus Archivage" })
      .returning();
    if (!organisation || !autreOrganisation) {
      throw new Error("Échec de l'insertion des organisations de test");
    }
    organisationId = organisation.id;
    autreOrganisationId = autreOrganisation.id;

    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId,
        email: `refus-archivage-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Refus",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    userId = user.id;

    const sci = await scisService.create(userId, {
      nom: "SCI Refus Archivage",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Refus Archivage",
      adresse: "1 rue du Refus",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: "1",
      type: "T2",
      nombrePiecesPrincipales: 2,
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

  describe("PATCH /appartements/:id/archiver", () => {
    it("refuse (409) un appartement dont le bail est actif, sans rien modifier", async () => {
      await bailActifAvecLocataires(["Dupont"]);

      const refus = dansMonOrganisation(() => appartementsService.archive(appartementId));
      await expect(refus).rejects.toThrow(ConflictException);
      await expect(dansMonOrganisation(() => appartementsService.archive(appartementId))).rejects.toThrow(
        MESSAGE_APPARTEMENT
      );

      const [appartement] = await db.select().from(appartements).where(eq(appartements.id, appartementId));
      expect(appartement?.statut).toBe("loue");
      expect(appartement?.archivedAt).toBeNull();
    });

    it("refuse aussi un bail en préavis", async () => {
      const { bailId } = await bailActifAvecLocataires(["Dupont"]);
      await db.update(baux).set({ statut: "preavis" }).where(eq(baux.id, bailId));

      await expect(dansMonOrganisation(() => appartementsService.archive(appartementId))).rejects.toThrow(
        MESSAGE_APPARTEMENT
      );
    });

    it("autorise l'archivage quand le seul bail est un brouillon", async () => {
      await bauxService.create({ appartementId, typeBail: "vide", dateDebut: DATE_DEBUT, jourEcheance: 5 });

      const archive = await dansMonOrganisation(() => appartementsService.archive(appartementId));
      expect(archive.statut).toBe("archive");
    });

    it("autorise l'archivage une fois le bail résilié", async () => {
      const { bailId } = await bailActifAvecLocataires(["Dupont"]);
      await dansMonOrganisation(() => bauxService.resilier(bailId, { dateFin: "2026-10-31" }));

      const archive = await dansMonOrganisation(() => appartementsService.archive(appartementId));
      expect(archive.statut).toBe("archive");
    });

    it("404 pour une autre organisation avant tout 409 (bail actif)", async () => {
      await bailActifAvecLocataires(["Dupont"]);

      await expect(dansUneAutreOrganisation(() => appartementsService.archive(appartementId))).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe("PATCH /locataires/:id/archiver", () => {
    it("refuse (409) un locataire encore rattaché à un bail actif, sans rien modifier", async () => {
      const { locataireIds } = await bailActifAvecLocataires(["Dupont"]);
      const locataireId = locataireIds[0]!;

      await expect(dansMonOrganisation(() => locatairesService.archive(locataireId))).rejects.toThrow(
        MESSAGE_LOCATAIRE
      );

      const [locataire] = await db.select().from(locataires).where(eq(locataires.id, locataireId));
      expect(locataire?.statut).not.toBe("archive");
      expect(locataire?.archivedAt).toBeNull();
    });

    it("autorise l'archivage d'un colocataire retiré du bail actif", async () => {
      const { liens, locataireIds } = await bailActifAvecLocataires(["Dupont", "Martin"]);
      await dansMonOrganisation(() => bailLocatairesService.archive(liens[1]!.id));

      const archive = await dansMonOrganisation(() => locatairesService.archive(locataireIds[1]!));
      expect(archive.statut).toBe("archive");
    });

    it("autorise l'archivage d'un locataire rattaché seulement à un bail brouillon", async () => {
      const bail = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: DATE_DEBUT, jourEcheance: 5 });
      const locataire = await locatairesService.create(userId, { nom: "Brouillon", prenom: "Test" });
      await bailLocatairesService.create({ bailId: bail.id, locataireId: locataire.id, role: "titulaire" });

      const archive = await dansMonOrganisation(() => locatairesService.archive(locataire.id));
      expect(archive.statut).toBe("archive");
    });

    it("autorise l'archivage une fois le bail résilié", async () => {
      const { bailId, locataireIds } = await bailActifAvecLocataires(["Dupont"]);
      await dansMonOrganisation(() => bauxService.resilier(bailId, { dateFin: "2026-10-31" }));

      const archive = await dansMonOrganisation(() => locatairesService.archive(locataireIds[0]!));
      expect(archive.statut).toBe("archive");
    });

    it("404 pour une autre organisation avant tout 409 (locataire au bail actif)", async () => {
      const { locataireIds } = await bailActifAvecLocataires(["Dupont"]);

      await expect(dansUneAutreOrganisation(() => locatairesService.archive(locataireIds[0]!))).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe("PATCH /bail-locataires/:id/archiver", () => {
    it("refuse (409) de retirer le dernier locataire d'un bail actif, sans rien modifier", async () => {
      const { liens } = await bailActifAvecLocataires(["Dupont"]);

      await expect(dansMonOrganisation(() => bailLocatairesService.archive(liens[0]!.id))).rejects.toThrow(
        MESSAGE_DERNIER_LOCATAIRE
      );

      const [lien] = await db.select().from(bailLocataires).where(eq(bailLocataires.id, liens[0]!.id));
      expect(lien?.archivedAt).toBeNull();
    });

    it("refuse aussi le dernier locataire restant, une fois les autres retirés", async () => {
      const { liens } = await bailActifAvecLocataires(["Dupont", "Martin"]);
      await dansMonOrganisation(() => bailLocatairesService.archive(liens[1]!.id));

      await expect(dansMonOrganisation(() => bailLocatairesService.archive(liens[0]!.id))).rejects.toThrow(
        MESSAGE_DERNIER_LOCATAIRE
      );
    });

    it("autorise le retrait d'un colocataire quand il en reste un autre", async () => {
      const { liens } = await bailActifAvecLocataires(["Dupont", "Martin"]);

      const retire = await dansMonOrganisation(() => bailLocatairesService.archive(liens[1]!.id));
      expect(retire.archivedAt).not.toBeNull();
    });

    it("autorise le retrait du dernier locataire d'un bail brouillon", async () => {
      const bail = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: DATE_DEBUT, jourEcheance: 5 });
      const locataire = await locatairesService.create(userId, { nom: "Brouillon", prenom: "Test" });
      const lien = await bailLocatairesService.create({ bailId: bail.id, locataireId: locataire.id, role: "titulaire" });

      const retire = await dansMonOrganisation(() => bailLocatairesService.archive(lien.id));
      expect(retire.archivedAt).not.toBeNull();
    });

    it("autorise le retrait du dernier locataire d'un bail résilié", async () => {
      const { bailId, liens } = await bailActifAvecLocataires(["Dupont"]);
      await dansMonOrganisation(() => bauxService.resilier(bailId, { dateFin: "2026-10-31" }));

      const retire = await dansMonOrganisation(() => bailLocatairesService.archive(liens[0]!.id));
      expect(retire.archivedAt).not.toBeNull();
    });

    it("404 pour une autre organisation avant tout 409 (dernier locataire)", async () => {
      const { liens } = await bailActifAvecLocataires(["Dupont"]);

      await expect(dansUneAutreOrganisation(() => bailLocatairesService.archive(liens[0]!.id))).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe("PATCH /baux/:id/resilier", () => {
    it("refuse (409) une date de fin dans le futur, message exact, sans rien modifier", async () => {
      const { bailId } = await bailActifAvecLocataires(["Dupont"]);
      const paiementsAvant = await db.select().from(paiements).where(eq(paiements.bailId, bailId));

      const refus = dansMonOrganisation(() => bauxService.resilier(bailId, { dateFin: "2099-01-15" }));
      await expect(refus).rejects.toThrow(ConflictException);
      await expect(
        dansMonOrganisation(() => bauxService.resilier(bailId, { dateFin: "2099-01-15" }))
      ).rejects.toThrow(MESSAGE_DATE_FUTURE);

      const [bail] = await db.select().from(baux).where(eq(baux.id, bailId));
      expect(bail?.statut).toBe("actif");
      expect(bail?.dateFin).toBeNull();
      expect(bail?.dateResiliation).toBeNull();
      const paiementsApres = await db.select().from(paiements).where(eq(paiements.bailId, bailId));
      expect(paiementsApres).toEqual(paiementsAvant);
      const [appartement] = await db.select().from(appartements).where(eq(appartements.id, appartementId));
      expect(appartement?.statut).toBe("loue");
    });

    it("refuse aussi une date future sur un bail en préavis", async () => {
      const { bailId } = await bailActifAvecLocataires(["Dupont"]);
      await db.update(baux).set({ statut: "preavis" }).where(eq(baux.id, bailId));

      await expect(
        dansMonOrganisation(() => bauxService.resilier(bailId, { dateFin: "2099-01-15" }))
      ).rejects.toThrow(MESSAGE_DATE_FUTURE);
      const [bail] = await db.select().from(baux).where(eq(baux.id, bailId));
      expect(bail?.statut).toBe("preavis");
    });

    it("autorise la date du jour (Europe/Paris)", async () => {
      const { bailId } = await bailActifAvecLocataires(["Dupont"]);
      const aujourdHui = dateDuJourParis();

      const resilie = await dansMonOrganisation(() => bauxService.resilier(bailId, { dateFin: aujourdHui }));
      expect(resilie.statut).toBe("resilie");
      expect(resilie.dateFin).toBe(aujourdHui);
    });

    // Chantier financier de la résiliation (décision 4 du 2026-11-14) :
    // la date de fin est désormais obligatoire.
    it("sans date saisie : refusée (400), le bail reste actif", async () => {
      const { bailId } = await bailActifAvecLocataires(["Dupont"]);

      await expect(
        dansMonOrganisation(() => bauxService.resilier(bailId, {} as unknown as { dateFin: string }))
      ).rejects.toThrow(BadRequestException);
      const [bail] = await db.select().from(baux).where(eq(baux.id, bailId));
      expect(bail?.statut).toBe("actif");
    });

    it("404 pour une autre organisation avant tout 409 (date future)", async () => {
      const { bailId } = await bailActifAvecLocataires(["Dupont"]);

      await expect(
        dansUneAutreOrganisation(() => bauxService.resilier(bailId, { dateFin: "2099-01-15" }))
      ).rejects.toThrow(NotFoundException);
    });
  });
});
