import { randomUUID } from "crypto";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  appartements,
  baux,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
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
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { BauxModule } from "./baux.module";
import { BauxService } from "./baux.service";

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  bailId: string;
}

// Sous-commit 5c (chantier scoping multi-organisation, 2026-09-18) :
// BauxService.findById() ne vérifiait jusqu'ici jamais l'appartenance à
// l'organisation. baux n'a pas de colonne organisationId directe (voir
// findAll()), le contrôle passe par une double jointure appartements ->
// bien. Aucun autre appelant interne (vérifié par grep — seul
// BauxController.findOne l'appelle).
//
// activer()/resilier() refont chacune leur propre requête brute sur `id` —
// non protégées par ce sous-commit (Catégorie C, audit séparé). Corrigées
// en Priorité 2 (2026-09-19) via verifierAppartenanceBail(), appelé avant
// l'ouverture de leur transaction respective : voir le describe dédié plus
// bas dans ce fichier pour leur couverture cross-org.
describe("BauxService.findById — contrôle d'appartenance à l'organisation (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Baux Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `baux-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `BauxScoping${suffixe}`,
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

    return { organisationId: organisation.id, userId: user.id, bailId: bail.id };
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
        BauxModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    bauxService = moduleRef.get(BauxService);
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

  it("réussit normalement quand le bail appartient à l'organisation appelante", async () => {
    const bail = await contexteOrgA(() => bauxService.findById(orgA.bailId));
    expect(bail.id).toBe(orgA.bailId);
  });

  it("404 sur le bailId d'une autre organisation", async () => {
    await expect(contexteOrgB(() => bauxService.findById(orgA.bailId))).rejects.toThrow(NotFoundException);
  });

  it("404 sur un bailId inexistant", async () => {
    await expect(contexteOrgA(() => bauxService.findById(randomUUID()))).rejects.toThrow(NotFoundException);
  });

  it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
    const bail = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
      bauxService.findById(orgA.bailId)
    );
    expect(bail.id).toBe(orgA.bailId);
  });
});

interface FixtureOrganisationTransactionnel {
  organisationId: string;
  userId: string;
  bailBrouillonId: string;
  appartementBrouillonId: string;
  bailActifId: string;
  appartementActifId: string;
}

// Priorité 2 (chantier scoping multi-organisation, Catégorie C, 2026-09-19) :
// activer() et resilier() ouvrent chacune une transaction qui crée/modifie
// des paiements et modifie le statut de l'appartement — sans contrôle
// d'appartenance, un bailId d'une autre organisation menait à ces effets de
// bord réels sur des données étrangères. Corrigé via
// verifierAppartenanceBail(), appelé avant l'ouverture de la transaction.
// Fixture dédiée (distincte de celle de findById() ci-dessus) : un bail
// encore 'brouillon' prêt à activer, et un bail déjà 'actif' prêt à
// résilier, chacun avec son propre appartement pour isoler les assertions.
describe("BauxService.activer / resilier — contrôle d'appartenance (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisationTransactionnel;
  let orgB: FixtureOrganisationTransactionnel;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisationTransactionnel> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Baux Transactionnel Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `baux-transactionnel-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `BauxTransactionnelScoping${suffixe}`,
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

    const appartementBrouillon = await appartementsService.create({
      bienId: bien.id,
      numero: `${suffixe}-brouillon`,
      type: "T3",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    const bailBrouillon = await bauxService.create({
      appartementId: appartementBrouillon.id,
      typeBail: "vide",
      dateDebut: "2026-01-01",
      loyerMensuel: "800.00",
      jourEcheance: 5
    });

    const appartementActif = await appartementsService.create({
      bienId: bien.id,
      numero: `${suffixe}-actif`,
      type: "T3",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    const bailAActiver = await bauxService.create({
      appartementId: appartementActif.id,
      typeBail: "vide",
      dateDebut: "2026-01-01",
      loyerMensuel: "800.00",
      jourEcheance: 5
    });
    // Hors contexte HTTP (comme le reste de cette fixture) : le contrôle
    // ajouté par ce commit est ignoré pendant la préparation, même
    // principe que documents-scoping.integration.spec.ts.
    const bailActif = await bauxService.activer(bailAActiver.id);

    return {
      organisationId: organisation.id,
      userId: user.id,
      bailBrouillonId: bailBrouillon.id,
      appartementBrouillonId: appartementBrouillon.id,
      bailActifId: bailActif.id,
      appartementActifId: appartementActif.id
    };
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
        BauxModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    bauxService = moduleRef.get(BauxService);
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

  it("active normalement quand le bail appartient à l'organisation appelante", async () => {
    const bail = await contexteOrgA(() => bauxService.activer(orgA.bailBrouillonId));
    expect(bail.statut).toBe("actif");
  });

  it("404 sur le bailId d'une autre organisation lors de l'activation, sans jamais créer de paiement ni modifier l'appartement", async () => {
    await expect(contexteOrgB(() => bauxService.activer(orgA.bailBrouillonId))).rejects.toThrow(NotFoundException);

    const paiementsCrees = await db.select().from(paiements).where(eq(paiements.bailId, orgA.bailBrouillonId));
    expect(paiementsCrees).toHaveLength(0);

    const [bailInchange] = await db.select().from(baux).where(eq(baux.id, orgA.bailBrouillonId));
    expect(bailInchange?.statut).toBe("brouillon");
    expect(bailInchange?.dateActivation).toBeNull();

    const [appartementInchange] = await db.select().from(appartements).where(eq(appartements.id, orgA.appartementBrouillonId));
    expect(appartementInchange?.statut).not.toBe("loue");
  });

  it("404 sur un bailId inexistant lors de l'activation", async () => {
    await expect(contexteOrgA(() => bauxService.activer(randomUUID()))).rejects.toThrow(NotFoundException);
  });

  it("hors contexte HTTP (organisationId absent), le contrôle est ignoré pour activer() — comportement préexistant préservé", async () => {
    const bail = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
      bauxService.activer(orgA.bailBrouillonId)
    );
    expect(bail.statut).toBe("actif");
  });

  it("résilie normalement quand le bail appartient à l'organisation appelante", async () => {
    const resultat = await contexteOrgA(() => bauxService.resilier(orgA.bailActifId, { dateFin: "2026-12-31" }));
    expect(resultat.statut).toBe("resilie");
  });

  it("404 sur le bailId d'une autre organisation lors de la résiliation, sans jamais modifier de paiement ni le statut de l'appartement", async () => {
    const paiementsAvant = await db.select().from(paiements).where(eq(paiements.bailId, orgA.bailActifId));

    // dateFin choisie dans le même mois calendaire que l'échéance d'entrée
    // créée par activer() (2026-01-01) : si le contrôle d'appartenance ne
    // bloquait pas cet appel, le Cas A de resilier() (packages/core,
    // calculerProrataOccupationPartielle) modifierait réellement cette
    // échéance — la preuve d'absence d'effet de bord n'est donc pas
    // triviale ici.
    await expect(
      contexteOrgB(() => bauxService.resilier(orgA.bailActifId, { dateFin: "2026-01-15" }))
    ).rejects.toThrow(NotFoundException);

    const paiementsApres = await db.select().from(paiements).where(eq(paiements.bailId, orgA.bailActifId));
    expect(paiementsApres).toEqual(paiementsAvant);

    const [bailInchange] = await db.select().from(baux).where(eq(baux.id, orgA.bailActifId));
    expect(bailInchange?.statut).toBe("actif");
    expect(bailInchange?.dateFin).toBeNull();
    expect(bailInchange?.dateResiliation).toBeNull();

    const [appartementInchange] = await db.select().from(appartements).where(eq(appartements.id, orgA.appartementActifId));
    expect(appartementInchange?.statut).toBe("loue");
  });

  it("404 sur un bailId inexistant lors de la résiliation", async () => {
    await expect(contexteOrgA(() => bauxService.resilier(randomUUID(), {}))).rejects.toThrow(NotFoundException);
  });

  it("hors contexte HTTP (organisationId absent), le contrôle est ignoré pour resilier() — comportement préexistant préservé", async () => {
    const resultat = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
      bauxService.resilier(orgA.bailActifId, { dateFin: "2026-12-31" })
    );
    expect(resultat.statut).toBe("resilie");
  });
});
