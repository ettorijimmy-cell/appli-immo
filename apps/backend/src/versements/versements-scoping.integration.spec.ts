import { randomUUID } from "crypto";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, paiements, utilisateurs, versements, type Database } from "db";
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
import { PaiementsModule } from "../paiements/paiements.module";
import { PaiementsService } from "../paiements/paiements.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { VersementsModule } from "./versements.module";
import { VersementsService } from "./versements.service";

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  paiementId: string;
  versementId: string;
}

// Priorité 3b (chantier scoping multi-organisation, Catégorie C, 2026-09-19) :
// annuler() refaisait sa propre requête brute sur `id`, puis recalculait et
// réécrivait le statut du paiement lié — deux tables touchées, sans jamais
// vérifier l'organisation. versements n'a jamais eu de findById() (aucun
// endpoint de lecture à l'unité), donc pas de helper préexistant à
// réutiliser — extrait directement (resoudreVersementAvecAppartenance()),
// utilisé par annuler() avant toute lecture/écriture, y compris sur
// `paiements`. ajouter() a la même lacune (aucun contrôle d'appartenance
// sur dto.paiementId) mais reste hors périmètre de cette Priorité 3b — non
// demandé, signalé pour arbitrage futur.
describe("VersementsService.annuler — contrôle d'appartenance à l'organisation (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let paiementsService: PaiementsService;
  let versementsService: VersementsService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Versements Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `versements-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `VersementsScoping${suffixe}`,
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
    const paiement = await paiementsService.create({
      bailId: bail.id,
      type: "loyer",
      montant: "800.00",
      dateEcheance: "2026-01-05"
    });
    const versement = await versementsService.ajouter({
      paiementId: paiement.id,
      montant: "800.00",
      mode: "virement",
      dateVersement: "2026-01-05"
    });

    return { organisationId: organisation.id, userId: user.id, paiementId: paiement.id, versementId: versement.id };
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
        PaiementsModule,
        VersementsModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    bauxService = moduleRef.get(BauxService);
    paiementsService = moduleRef.get(PaiementsService);
    versementsService = moduleRef.get(VersementsService);
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

  it("réussit normalement quand le versement appartient à l'organisation appelante", async () => {
    const annule = await contexteOrgA(() => versementsService.annuler(orgA.versementId));
    expect(annule.archivedAt).not.toBeNull();
  });

  it("404 sur le versementId d'une autre organisation, sans jamais modifier le versement ni le statut du paiement lié", async () => {
    await expect(contexteOrgB(() => versementsService.annuler(orgA.versementId))).rejects.toThrow(
      NotFoundException
    );

    const [versementInchange] = await db.select().from(versements).where(eq(versements.id, orgA.versementId));
    expect(versementInchange?.archivedAt).toBeNull();

    // Le versement actif (800.00) couvre exactement le montant dû (800.00) :
    // si annuler() avait réellement recalculé le statut du paiement étranger
    // malgré le rejet, il basculerait de "paye" à "impaye" — la preuve
    // porte donc sur une vraie transition potentielle, pas une valeur figée
    // par construction.
    const [paiementInchange] = await db.select().from(paiements).where(eq(paiements.id, orgA.paiementId));
    expect(paiementInchange?.statut).toBe("paye");
  });

  it("404 sur un versementId inexistant", async () => {
    await expect(contexteOrgA(() => versementsService.annuler(randomUUID()))).rejects.toThrow(NotFoundException);
  });

  it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
    const annule = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
      versementsService.annuler(orgA.versementId)
    );
    expect(annule.archivedAt).not.toBeNull();
  });
});
