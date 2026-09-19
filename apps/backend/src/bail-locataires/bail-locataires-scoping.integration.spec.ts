import { randomUUID } from "crypto";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { bailLocataires, createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, utilisateurs, type Database } from "db";
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
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { BailLocatairesModule } from "./bail-locataires.module";
import { BailLocatairesService } from "./bail-locataires.service";

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  lienId: string;
}

// Priorité 3b (chantier scoping multi-organisation, Catégorie C, 2026-09-19) :
// archive() refaisait sa propre écriture via mettreAJourAvecAudit sans
// jamais vérifier l'organisation — ce service n'a jamais eu de findById()
// (aucun endpoint de lecture à l'unité), donc pas de helper préexistant à
// réutiliser — extrait ici directement (resoudreLienAvecAppartenance(),
// privée), même chemin de jointure que findAll() (bail_locataires -> baux
// -> appartements -> bien).
describe("BailLocatairesService.archive — contrôle d'appartenance à l'organisation (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let locatairesService: LocatairesService;
  let bailLocatairesService: BailLocatairesService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation BailLocataires Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `bail-locataires-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `BailLocatairesScoping${suffixe}`,
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
    const locataire = await locatairesService.create(user.id, { nom: "Dupont", prenom: `Alice${suffixe}` });
    const lien = await bailLocatairesService.create({ bailId: bail.id, locataireId: locataire.id, role: "titulaire" });

    return { organisationId: organisation.id, userId: user.id, lienId: lien.id };
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
        LocatairesModule,
        BailLocatairesModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    bauxService = moduleRef.get(BauxService);
    locatairesService = moduleRef.get(LocatairesService);
    bailLocatairesService = moduleRef.get(BailLocatairesService);
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

  it("réussit normalement quand le rattachement appartient à l'organisation appelante", async () => {
    const archive = await contexteOrgA(() => bailLocatairesService.archive(orgA.lienId));
    expect(archive.archivedAt).not.toBeNull();
  });

  it("404 sur le lienId d'une autre organisation, sans jamais archiver la ligne étrangère", async () => {
    await expect(contexteOrgB(() => bailLocatairesService.archive(orgA.lienId))).rejects.toThrow(
      NotFoundException
    );
    const [inchange] = await db.select().from(bailLocataires).where(eq(bailLocataires.id, orgA.lienId));
    expect(inchange?.archivedAt).toBeNull();
  });

  it("404 sur un lienId inexistant", async () => {
    await expect(contexteOrgA(() => bailLocatairesService.archive(randomUUID()))).rejects.toThrow(
      NotFoundException
    );
  });

  it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
    const archive = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
      bailLocatairesService.archive(orgA.lienId)
    );
    expect(archive.archivedAt).not.toBeNull();
  });
});
