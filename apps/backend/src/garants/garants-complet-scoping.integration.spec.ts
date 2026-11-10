import { randomUUID } from "crypto";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  baux,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  garants,
  locataires,
  organisations,
  utilisateurs,
  type Database
} from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { BailDocumentDocxModule } from "../bail-document-docx/bail-document-docx.module";
import { BailDocumentDocxService } from "../bail-document-docx/bail-document-docx.service";
import { BailLocatairesModule } from "../bail-locataires/bail-locataires.module";
import { BailLocatairesService } from "../bail-locataires/bail-locataires.service";
import { BauxModule } from "../baux/baux.module";
import { BauxService } from "../baux/baux.service";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { GarantsModule } from "./garants.module";
import { GarantsService } from "./garants.service";

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  appartementId: string;
  bailId: string;
  locataireId: string;
  garantId: string;
}

// Chantier garants complet (2026-11-08), commit 3 : contrôle d'appartenance
// à l'organisation sur les nouveaux champs (type de garant et numéro Visale,
// assurance loyers impayés, statut d'études) et sur la route de lecture
// GET /baux/:id/verification-garanties. Deux organisations A et B ; chaque
// test agit depuis A sur une ligne de B et vérifie le 404 (ou le 400) ET
// que la ligne de B n'a pas bougé.
describe("Garants complet — contrôle d'appartenance à l'organisation (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let garantsService: GarantsService;
  let bauxService: BauxService;
  let locatairesService: LocatairesService;
  let bailDocumentDocxService: BailDocumentDocxService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Garants Complet Scoping ${suffixe}` })
      .returning();
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation!.id,
        email: `garants-complet-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `GarantsComplet${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    const organisationId = organisation!.id;
    const userId = user!.id;

    // Création dans le contexte de l'organisation propriétaire : chaque
    // service applique déjà son propre contrôle à la création.
    return requestContextService.executerAvecContexte({ utilisateurId: userId, organisationId }, async () => {
      const bien = await moduleRef.get(BienService).create(userId, {
        type: "maison",
        proprietaireType: "personne_physique",
        nomProprietaire: `Propriétaire ${suffixe}`,
        adresse: "1 rue de Test",
        codePostal: "75001",
        ville: "Paris"
      });
      const appartement = await moduleRef.get(AppartementsService).create({
        bienId: bien.id,
        numero: suffixe,
        type: "T3",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel"
      });
      const bail = await bauxService.create({ appartementId: appartement.id, typeBail: "vide", dateDebut: "2026-01-01" });
      const locataire = await locatairesService.create(userId, { nom: "Bernard", prenom: `Lucie${suffixe}` });
      await moduleRef.get(BailLocatairesService).create({ bailId: bail.id, locataireId: locataire.id, role: "titulaire" });
      const garant = await garantsService.create({
        bailId: bail.id,
        typeGarantie: "personne_physique",
        nom: "Durand",
        prenom: `Claire${suffixe}`,
        locataireId: locataire.id
      });
      return {
        organisationId,
        userId,
        appartementId: appartement.id,
        bailId: bail.id,
        locataireId: locataire.id,
        garantId: garant.id
      };
    });
  }

  function depuis<T>(org: FixtureOrganisation, fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte({ utilisateurId: org.userId, organisationId: org.organisationId }, fn);
  }

  async function garantEnBase(id: string) {
    const [ligne] = await db.select().from(garants).where(eq(garants.id, id));
    return ligne!;
  }

  beforeEach(async () => {
    db = await begin();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        CommonModule,
        DatabaseModule,
        AuditModule,
        UsersModule,
        AuthModule,
        BienModule,
        AppartementsModule,
        LocatairesModule,
        BauxModule,
        BailLocatairesModule,
        GarantsModule,
        BailDocumentDocxModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    garantsService = moduleRef.get(GarantsService);
    bauxService = moduleRef.get(BauxService);
    locatairesService = moduleRef.get(LocatairesService);
    bailDocumentDocxService = moduleRef.get(BailDocumentDocxService);
    requestContextService = moduleRef.get(RequestContextService);

    orgA = await creerFixtureOrganisation("A");
    orgB = await creerFixtureOrganisation("B");
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  describe("garants", () => {
    it("création d'un garant Visale sur le bail d'une autre organisation : 404, aucune ligne insérée", async () => {
      await expect(
        depuis(orgA, () =>
          garantsService.create({ bailId: orgB.bailId, typeGarantie: "garantie_visale", numeroContratVisale: "V0001" })
        )
      ).rejects.toThrow(new NotFoundException("Bail introuvable"));
      const garantsDeB = await db.select().from(garants).where(eq(garants.bailId, orgB.bailId));
      expect(garantsDeB.map((g) => g.id)).toEqual([orgB.garantId]);
    });

    it("création d'une caution sur son bail avec « Caution de » = locataire d'une autre organisation : 400, rien d'inséré", async () => {
      await expect(
        depuis(orgA, () =>
          garantsService.create({
            bailId: orgA.bailId,
            typeGarantie: "personne_physique",
            nom: "Martin",
            prenom: "Paul",
            locataireId: orgB.locataireId
          })
        )
      ).rejects.toThrow(BadRequestException);
      const garantsDeA = await db.select().from(garants).where(eq(garants.bailId, orgA.bailId));
      expect(garantsDeA.map((g) => g.id)).toEqual([orgA.garantId]);
    });

    it("passage en Visale du garant d'une autre organisation : 404, ligne étrangère inchangée", async () => {
      const avant = await garantEnBase(orgB.garantId);
      await expect(
        depuis(orgA, () =>
          garantsService.update(orgB.garantId, { typeGarantie: "garantie_visale", numeroContratVisale: "V0001" })
        )
      ).rejects.toThrow(new NotFoundException("Garant introuvable"));
      expect(await garantEnBase(orgB.garantId)).toEqual(avant);
    });

    it("numéro Visale sur le garant Visale d'une autre organisation : 404, ligne étrangère inchangée", async () => {
      const visaleB = await depuis(orgB, () =>
        garantsService.create({ bailId: orgB.bailId, typeGarantie: "garantie_visale", numeroContratVisale: "V-B" })
      );
      await expect(
        depuis(orgA, () => garantsService.update(visaleB.id, { numeroContratVisale: "V-A" }))
      ).rejects.toThrow(new NotFoundException("Garant introuvable"));
      expect((await garantEnBase(visaleB.id)).numeroContratVisale).toBe("V-B");
    });

    it("modification de son garant avec « Caution de » = locataire d'une autre organisation : 400, rien de modifié", async () => {
      const avant = await garantEnBase(orgA.garantId);
      await expect(
        depuis(orgA, () => garantsService.update(orgA.garantId, { locataireId: orgB.locataireId }))
      ).rejects.toThrow(BadRequestException);
      expect(await garantEnBase(orgA.garantId)).toEqual(avant);
    });
  });

  describe("bail : assurance loyers impayés", () => {
    it("modification sur le bail d'une autre organisation : 404, bail étranger inchangé", async () => {
      await expect(
        depuis(orgA, () => bauxService.update(orgB.bailId, { assuranceLoyersImpayes: true }))
      ).rejects.toThrow(NotFoundException);
      const [bailB] = await db.select().from(baux).where(eq(baux.id, orgB.bailId));
      expect(bailB!.assuranceLoyersImpayes).toBe(false);
    });

    it("création d'un bail assuré sur l'appartement d'une autre organisation : 404, aucun bail créé", async () => {
      const bauxDeBAvant = await db.select().from(baux).where(eq(baux.appartementId, orgB.appartementId));
      await expect(
        depuis(orgA, () =>
          bauxService.create({
            appartementId: orgB.appartementId,
            typeBail: "vide",
            dateDebut: "2026-03-01",
            assuranceLoyersImpayes: true
          })
        )
      ).rejects.toThrow(NotFoundException);
      const bauxDeBApres = await db.select().from(baux).where(eq(baux.appartementId, orgB.appartementId));
      expect(bauxDeBApres.map((b) => b.id)).toEqual(bauxDeBAvant.map((b) => b.id));
    });
  });

  describe("locataire : statut d'études", () => {
    it("modification sur le locataire d'une autre organisation : 404, locataire étranger inchangé", async () => {
      await expect(
        depuis(orgA, () => locatairesService.update(orgB.locataireId, { statutEtudes: "apprenti" }))
      ).rejects.toThrow(NotFoundException);
      const [locataireB] = await db.select().from(locataires).where(eq(locataires.id, orgB.locataireId));
      expect(locataireB!.statutEtudes).toBe("non_renseigne");
    });
  });

  describe("GET /baux/:id/verification-garanties", () => {
    it("son bail : renvoie les violations de verifierGarantiesBail", async () => {
      // Rien à signaler : une caution « Caution de » renseignée, bailleur
      // personne physique, sans assurance.
      expect(await depuis(orgA, () => bailDocumentDocxService.verifierGarantiesDuBail(orgA.bailId))).toEqual([]);

      await depuis(orgA, () => bauxService.update(orgA.bailId, { assuranceLoyersImpayes: true }));
      const violations = await depuis(orgA, () => bailDocumentDocxService.verifierGarantiesDuBail(orgA.bailId));
      expect(violations).toEqual([
        expect.objectContaining({ code: "caution_interdite_assurance_loyers_impayes", garantId: orgA.garantId })
      ]);
    });

    it("bail d'une autre organisation : 404, même message qu'un bail inexistant", async () => {
      await expect(
        depuis(orgA, () => bailDocumentDocxService.verifierGarantiesDuBail(orgB.bailId))
      ).rejects.toThrow(new NotFoundException("Bail introuvable"));
      await expect(
        depuis(orgA, () => bailDocumentDocxService.verifierGarantiesDuBail(randomUUID()))
      ).rejects.toThrow(new NotFoundException("Bail introuvable"));
    });
  });
});
