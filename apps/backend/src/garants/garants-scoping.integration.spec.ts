import { randomUUID } from "crypto";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, garants, organisations, utilisateurs, type Database } from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuthModule } from "../auth/auth.module";
import { BauxModule } from "../baux/baux.module";
import { BauxService } from "../baux/baux.service";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { GarantsModule } from "./garants.module";
import { GarantsService } from "./garants.service";

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  garantId: string;
  bailId: string;
}

// Sous-commit 5a (chantier scoping multi-organisation, 2026-09-18) :
// GarantsService.findById() ne vérifiait jusqu'ici jamais l'appartenance à
// l'organisation. organisationId est une colonne directe (dénormalisée
// depuis bien.organisationId à la création, voir GarantsService.create) :
// contrôle par simple comparaison, sans jointure à la lecture. Aucun autre
// appelant interne (vérifié par grep — seul GarantsController.findOne
// l'appelle).
//
// update()/archive() n'étaient pas protégées par ce sous-commit (Catégorie
// C, audit séparé) — corrigées en Priorité 3a (2026-09-19) via
// resoudreGarantAvecAppartenance(), le même helper privé que findById()
// (aucun appelant interne, seul GarantsController).
//
// create() (Priorité E1, chantier scoping multi-organisation, Catégorie E,
// 2026-09-19) : dto.bailId n'était vérifié que pour son existence — jamais
// pour son appartenance à l'organisation appelante. organisationId du
// garant est dérivé du bail (jamais de l'utilisateur courant), donc sans
// ce contrôle un appelant de l'organisation A pouvait injecter directement
// un garant dans l'organisation B en fournissant un bailId de B, sans
// jamais posséder de compte B — le cas le plus sévère de tout l'audit
// Catégorie E. Corrigé en filtrant la jointure bail -> appartement -> bien
// déjà nécessaire pour résoudre l'organisationId à écrire, plutôt qu'un
// helper séparé (aucun helper findById()/verifierAppartenanceBail() de
// GarantsService/BauxService n'était directement réutilisable ici : celui
// de BauxService est privé et GarantsModule ne dépend pas de BauxModule).
describe("GarantsService — contrôle d'appartenance à l'organisation (create/findById/update/archive, intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let garantsService: GarantsService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Garants Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `garants-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `GarantsScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }

    const bien = await bienService.create(user.id, {
      type: "maison",
      proprietaireType: "personne_physique",
      nomProprietaire: `Propriétaire ${suffixe}`,
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: suffixe,
      type: "T3",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    const bail = await bauxService.create({ appartementId: appartement.id, typeBail: "vide", dateDebut: "2026-01-01" });
    const garant = await garantsService.create({
      bailId: bail.id,
      nom: "Durand",
      prenom: `Claire${suffixe}`,
      typeGarantie: "personne_physique"
    });

    return { organisationId: organisation.id, userId: user.id, garantId: garant.id, bailId: bail.id };
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
        BienModule,
        AppartementsModule,
        BauxModule,
        GarantsModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    bauxService = moduleRef.get(BauxService);
    garantsService = moduleRef.get(GarantsService);
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

  describe("create", () => {
    it("réussit normalement quand le bail appartient à l'organisation appelante", async () => {
      const garant = await contexteOrgA(() =>
        garantsService.create({ bailId: orgA.bailId, nom: "Nouveau", prenom: "Garant", typeGarantie: "personne_physique" })
      );
      expect(garant.bailId).toBe(orgA.bailId);
    });

    it("404 sur le bailId d'une autre organisation, sans jamais insérer de ligne garants — ni chez l'appelant ni chez le propriétaire réel du bail", async () => {
      await expect(
        contexteOrgB(() =>
          garantsService.create({ bailId: orgA.bailId, nom: "Etranger", prenom: "Bob", typeGarantie: "personne_physique" })
        )
      ).rejects.toThrow(NotFoundException);

      const lignesLieesAuBail = await db.select().from(garants).where(eq(garants.bailId, orgA.bailId));
      // Seul le garant de fixture (créé hors contexte HTTP dans
      // creerFixtureOrganisation) doit exister pour ce bail — aucune
      // ligne supplémentaire injectée par la tentative cross-org.
      expect(lignesLieesAuBail).toHaveLength(1);
      expect(lignesLieesAuBail[0]?.id).toBe(orgA.garantId);

      const lignesOrgA = await db.select().from(garants).where(eq(garants.organisationId, orgA.organisationId));
      expect(lignesOrgA.map((l) => l.id)).toEqual([orgA.garantId]);
      const lignesOrgB = await db.select().from(garants).where(eq(garants.organisationId, orgB.organisationId));
      expect(lignesOrgB.map((l) => l.id)).toEqual([orgB.garantId]);
    });

    it("404 sur un bailId inexistant", async () => {
      await expect(
        contexteOrgA(() =>
          garantsService.create({ bailId: randomUUID(), nom: "Personne", prenom: "Inconnue", typeGarantie: "personne_physique" })
        )
      ).rejects.toThrow(NotFoundException);
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const garant = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        garantsService.create({ bailId: orgB.bailId, nom: "Sans", prenom: "Contexte", typeGarantie: "personne_physique" })
      );
      // organisationId reste dérivé du bail (comportement préexistant,
      // jamais de l'utilisateur courant) : ici celui d'orgB, puisque
      // c'est le bail fourni — pas une régression, juste l'absence de
      // contrôle hors contexte HTTP. versDto() n'expose pas organisationId,
      // vérifié directement en base.
      expect(garant.bailId).toBe(orgB.bailId);
      const [ligneEnBase] = await db.select().from(garants).where(eq(garants.id, garant.id));
      expect(ligneEnBase?.organisationId).toBe(orgB.organisationId);
    });
  });

  describe("findById", () => {
    it("réussit normalement quand le garant appartient à l'organisation appelante", async () => {
      const garant = await contexteOrgA(() => garantsService.findById(orgA.garantId));
      expect(garant.id).toBe(orgA.garantId);
    });

    it("404 sur le garantId d'une autre organisation", async () => {
      await expect(contexteOrgB(() => garantsService.findById(orgA.garantId))).rejects.toThrow(NotFoundException);
    });

    it("404 sur un garantId inexistant", async () => {
      await expect(contexteOrgA(() => garantsService.findById(randomUUID()))).rejects.toThrow(NotFoundException);
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const garant = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        garantsService.findById(orgA.garantId)
      );
      expect(garant.id).toBe(orgA.garantId);
    });
  });

  describe("update", () => {
    it("réussit normalement quand le garant appartient à l'organisation appelante", async () => {
      const garant = await contexteOrgA(() => garantsService.update(orgA.garantId, { telephone: "0611111111" }));
      expect(garant.telephone).toBe("0611111111");
    });

    it("404 sur le garantId d'une autre organisation, sans jamais modifier la ligne étrangère", async () => {
      await expect(
        contexteOrgB(() => garantsService.update(orgA.garantId, { telephone: "0611111111" }))
      ).rejects.toThrow(NotFoundException);
      const [inchange] = await db.select().from(garants).where(eq(garants.id, orgA.garantId));
      expect(inchange?.telephone).toBeNull();
    });

    it("404 sur un garantId inexistant", async () => {
      await expect(
        contexteOrgA(() => garantsService.update(randomUUID(), { telephone: "0611111111" }))
      ).rejects.toThrow(NotFoundException);
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const garant = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        garantsService.update(orgA.garantId, { telephone: "0611111111" })
      );
      expect(garant.telephone).toBe("0611111111");
    });
  });

  describe("archive", () => {
    it("réussit normalement quand le garant appartient à l'organisation appelante", async () => {
      const archive = await contexteOrgA(() => garantsService.archive(orgA.garantId));
      expect(archive.archivedAt).not.toBeNull();
    });

    it("404 sur le garantId d'une autre organisation, sans jamais archiver la ligne étrangère", async () => {
      await expect(contexteOrgB(() => garantsService.archive(orgA.garantId))).rejects.toThrow(NotFoundException);
      const [inchange] = await db.select().from(garants).where(eq(garants.id, orgA.garantId));
      expect(inchange?.archivedAt).toBeNull();
    });

    it("404 sur un garantId inexistant", async () => {
      await expect(contexteOrgA(() => garantsService.archive(randomUUID()))).rejects.toThrow(NotFoundException);
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const archive = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        garantsService.archive(orgA.garantId)
      );
      expect(archive.archivedAt).not.toBeNull();
    });
  });
});
