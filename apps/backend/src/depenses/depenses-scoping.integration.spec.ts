import { randomUUID } from "crypto";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { depense, createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, utilisateurs, type Database } from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { ReglesCategorisationModule } from "../regles-categorisation/regles-categorisation.module";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { DepensesModule } from "./depenses.module";
import { DepensesService } from "./depenses.service";

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  sciId: string;
  bienId: string;
  appartementId: string;
}

// Audit 2026-10-12 (docs/backlog.md) : DepensesService.create n'avait
// jamais été traité par le chantier de scoping multi-organisation
// (Catégorie E, 2026-09-19) — bienId/sciId en étaient déjà des oublis à
// cette date, appartementId une régression ajoutée après la clôture du
// chantier (commit fcb3f50, 2026-10-01). Même convention que
// bien-scoping.integration.spec.ts : contrôle d'appartenance via
// OrganisationResolutionService.resoudreEntiteIdsOrganisation, NotFoundException
// sur un id étranger, contrôle sauté hors contexte HTTP (organisationId absent).
describe("DepensesService.create — contrôle d'appartenance à l'organisation (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let depensesService: DepensesService;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Dépenses Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `depenses-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `DepensesScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }

    const sci = await scisService.create(user.id, {
      nom: `SCI Dépenses Scoping ${suffixe}`,
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(user.id, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: `Immeuble Dépenses Scoping ${suffixe}`,
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: `L-${suffixe}`,
      type: "T2",
      surface: "45.50",
      nombrePiecesPrincipales: 2,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });

    return { organisationId: organisation.id, userId: user.id, sciId: sci.id, bienId: bien.id, appartementId: appartement.id };
  }

  beforeEach(async () => {
    db = await begin();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        CommonModule,
        DatabaseModule,
        UsersModule,
        ScisModule,
        BienModule,
        AppartementsModule,
        ReglesCategorisationModule,
        DepensesModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    depensesService = moduleRef.get(DepensesService);
    scisService = moduleRef.get(ScisService);
    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
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

  function contexteOrgA<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte({ utilisateurId: orgA.userId, organisationId: orgA.organisationId }, fn);
  }
  function contexteOrgB<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte({ utilisateurId: orgB.userId, organisationId: orgB.organisationId }, fn);
  }

  async function aucuneDepenseAvecLibelle(libelle: string): Promise<void> {
    const lignes = await db.select().from(depense).where(eq(depense.libelle, libelle));
    expect(lignes).toHaveLength(0);
  }

  describe("appartementId", () => {
    it("404 sur l'appartementId d'une autre organisation (B tente avec l'appartement de A), sans créer de dépense", async () => {
      const libelle = "Dépense appartement étranger A→B";
      await expect(
        contexteOrgB(() =>
          depensesService.create(orgB.userId, {
            categorie: "reparation_entretien",
            montant: "50.00",
            dateDepense: "2026-10-12",
            libelle,
            appartementId: orgA.appartementId
          })
        )
      ).rejects.toThrow(NotFoundException);
      await aucuneDepenseAvecLibelle(libelle);
    });

    it("404 sur l'appartementId d'une autre organisation (A tente avec l'appartement de B), sans créer de dépense", async () => {
      const libelle = "Dépense appartement étranger B→A";
      await expect(
        contexteOrgA(() =>
          depensesService.create(orgA.userId, {
            categorie: "reparation_entretien",
            montant: "50.00",
            dateDepense: "2026-10-12",
            libelle,
            appartementId: orgB.appartementId
          })
        )
      ).rejects.toThrow(NotFoundException);
      await aucuneDepenseAvecLibelle(libelle);
    });

    it("réussit normalement quand l'appartement appartient à l'organisation appelante", async () => {
      const depenseCreee = await contexteOrgA(() =>
        depensesService.create(orgA.userId, {
          categorie: "reparation_entretien",
          montant: "50.00",
          dateDepense: "2026-10-12",
          libelle: "Dépense appartement légitime",
          appartementId: orgA.appartementId
        })
      );
      expect(depenseCreee.appartementId).toBe(orgA.appartementId);
    });
  });

  describe("bienId", () => {
    it("404 sur le bienId d'une autre organisation (B tente avec le bien de A), sans créer de dépense", async () => {
      const libelle = "Dépense bien étranger A→B";
      await expect(
        contexteOrgB(() =>
          depensesService.create(orgB.userId, {
            categorie: "charges_copropriete",
            montant: "100.00",
            dateDepense: "2026-10-12",
            libelle,
            bienId: orgA.bienId
          })
        )
      ).rejects.toThrow(NotFoundException);
      await aucuneDepenseAvecLibelle(libelle);
    });

    it("404 sur le bienId d'une autre organisation (A tente avec le bien de B), sans créer de dépense", async () => {
      const libelle = "Dépense bien étranger B→A";
      await expect(
        contexteOrgA(() =>
          depensesService.create(orgA.userId, {
            categorie: "charges_copropriete",
            montant: "100.00",
            dateDepense: "2026-10-12",
            libelle,
            bienId: orgB.bienId
          })
        )
      ).rejects.toThrow(NotFoundException);
      await aucuneDepenseAvecLibelle(libelle);
    });

    it("réussit normalement quand le bien appartient à l'organisation appelante", async () => {
      const depenseCreee = await contexteOrgA(() =>
        depensesService.create(orgA.userId, {
          categorie: "charges_copropriete",
          montant: "100.00",
          dateDepense: "2026-10-12",
          libelle: "Dépense bien légitime",
          bienId: orgA.bienId
        })
      );
      expect(depenseCreee.bienId).toBe(orgA.bienId);
    });
  });

  describe("sciId transmis seul", () => {
    it("404 sur le sciId d'une autre organisation (B tente avec la SCI de A), sans créer de dépense", async () => {
      const libelle = "Dépense SCI étrangère A→B";
      await expect(
        contexteOrgB(() =>
          depensesService.create(orgB.userId, {
            categorie: "frais_gestion",
            montant: "30.00",
            dateDepense: "2026-10-12",
            libelle,
            sciId: orgA.sciId
          })
        )
      ).rejects.toThrow(NotFoundException);
      await aucuneDepenseAvecLibelle(libelle);
    });

    it("404 sur le sciId d'une autre organisation (A tente avec la SCI de B), sans créer de dépense", async () => {
      const libelle = "Dépense SCI étrangère B→A";
      await expect(
        contexteOrgA(() =>
          depensesService.create(orgA.userId, {
            categorie: "frais_gestion",
            montant: "30.00",
            dateDepense: "2026-10-12",
            libelle,
            sciId: orgB.sciId
          })
        )
      ).rejects.toThrow(NotFoundException);
      await aucuneDepenseAvecLibelle(libelle);
    });

    it("404 sur un sciId inexistant transmis seul", async () => {
      const libelle = "Dépense SCI fantôme";
      await expect(
        contexteOrgA(() =>
          depensesService.create(orgA.userId, {
            categorie: "frais_gestion",
            montant: "30.00",
            dateDepense: "2026-10-12",
            libelle,
            sciId: randomUUID()
          })
        )
      ).rejects.toThrow(NotFoundException);
      await aucuneDepenseAvecLibelle(libelle);
    });

    it("réussit normalement quand la SCI appartient à l'organisation appelante", async () => {
      const depenseCreee = await contexteOrgA(() =>
        depensesService.create(orgA.userId, {
          categorie: "frais_gestion",
          montant: "30.00",
          dateDepense: "2026-10-12",
          libelle: "Dépense SCI légitime",
          sciId: orgA.sciId
        })
      );
      expect(depenseCreee.sciId).toBe(orgA.sciId);
    });
  });

  describe("sciId étranger transmis avec un bienId de sa propre organisation", () => {
    it("404 malgré le bienId légitime — sciId reste contrôlé même s'il sera écrasé par bien.sciId", async () => {
      const libelle = "Dépense sciId étranger + bienId légitime";
      await expect(
        contexteOrgA(() =>
          depensesService.create(orgA.userId, {
            categorie: "assurance",
            montant: "80.00",
            dateDepense: "2026-10-12",
            libelle,
            bienId: orgA.bienId,
            sciId: orgB.sciId
          })
        )
      ).rejects.toThrow(NotFoundException);
      await aucuneDepenseAvecLibelle(libelle);
    });
  });

  describe("hors contexte HTTP (organisationId absent)", () => {
    it("le contrôle est ignoré — comportement préexistant préservé", async () => {
      const depenseCreee = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        depensesService.create(orgA.userId, {
          categorie: "reparation_entretien",
          montant: "50.00",
          dateDepense: "2026-10-12",
          libelle: "Dépense hors contexte HTTP",
          appartementId: orgB.appartementId
        })
      );
      expect(depenseCreee.appartementId).toBe(orgB.appartementId);
    });
  });
});
