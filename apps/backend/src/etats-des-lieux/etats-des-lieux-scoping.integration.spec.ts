import { randomUUID } from "crypto";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, utilisateurs, type Database } from "db";
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
import { EtatsDesLieuxModule } from "./etats-des-lieux.module";
import { EtatsDesLieuxService } from "./etats-des-lieux.service";

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  etatDesLieuxId: string;
  bailId: string;
}

// Sous-commit 5c (chantier scoping multi-organisation, 2026-09-18) :
// EtatsDesLieuxService.findById() ne vérifiait jusqu'ici jamais
// l'appartenance à l'organisation. etatsDesLieux n'a pas de colonne
// organisationId directe, le contrôle passe par une triple jointure baux
// -> appartements -> bien (via bailId). Deux appelants internes vérifiés :
// - findByBailId() (même fichier) délègue à this.findById() — protégé
//   par ricochet, sans code supplémentaire (voir test dédié ci-dessous).
// - EtatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx()
//   (B3, audit du Commit 5) appelle this.findById() en interne — protégé
//   par ricochet également ; couverture dédiée dans
//   etat-des-lieux-document-docx-scoping.integration.spec.ts, qui
//   confirme aussi que la génération continue de fonctionner normalement
//   pour un état des lieux de sa propre organisation.
describe("EtatsDesLieuxService.findById — contrôle d'appartenance à l'organisation (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let etatsDesLieuxService: EtatsDesLieuxService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation EtatsDesLieux Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `etats-des-lieux-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `EtatsDesLieuxScoping${suffixe}`,
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
    const appartementCree = await appartementsService.create({
      bienId: bien.id,
      numero: suffixe,
      type: "T3",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    // Composition (nombreChambres/nombreSallesDeBain/nombreWc) requise par
    // validerCompletudeEtatDesLieux avant toute création — même montage
    // que documents-scoping.integration.spec.ts.
    const appartement = await appartementsService.update(appartementCree.id, {
      nombreChambres: 1,
      nombreSallesDeBain: 1,
      nombreWc: 1
    });
    const bail = await bauxService.create({ appartementId: appartement.id, typeBail: "vide", dateDebut: "2026-01-01" });
    const etatDesLieux = await etatsDesLieuxService.create({ bailId: bail.id });

    return { organisationId: organisation.id, userId: user.id, etatDesLieuxId: etatDesLieux.id, bailId: bail.id };
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
        EtatsDesLieuxModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    bauxService = moduleRef.get(BauxService);
    etatsDesLieuxService = moduleRef.get(EtatsDesLieuxService);
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

  it("réussit normalement quand l'état des lieux appartient à l'organisation appelante", async () => {
    const etatDesLieux = await contexteOrgA(() => etatsDesLieuxService.findById(orgA.etatDesLieuxId));
    expect(etatDesLieux.id).toBe(orgA.etatDesLieuxId);
  });

  it("404 sur l'etatDesLieuxId d'une autre organisation", async () => {
    await expect(contexteOrgB(() => etatsDesLieuxService.findById(orgA.etatDesLieuxId))).rejects.toThrow(
      NotFoundException
    );
  });

  it("404 sur un etatDesLieuxId inexistant", async () => {
    await expect(contexteOrgA(() => etatsDesLieuxService.findById(randomUUID()))).rejects.toThrow(
      NotFoundException
    );
  });

  it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
    const etatDesLieux = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
      etatsDesLieuxService.findById(orgA.etatDesLieuxId)
    );
    expect(etatDesLieux.id).toBe(orgA.etatDesLieuxId);
  });

  it("findByBailId() est protégé par ricochet : 404 sur un bailId d'une autre organisation", async () => {
    await expect(contexteOrgB(() => etatsDesLieuxService.findByBailId(orgA.bailId))).rejects.toThrow(
      NotFoundException
    );
  });

  it("findByBailId() réussit normalement quand le bail appartient à l'organisation appelante", async () => {
    const etatDesLieux = await contexteOrgA(() => etatsDesLieuxService.findByBailId(orgA.bailId));
    expect(etatDesLieux?.id).toBe(orgA.etatDesLieuxId);
  });
});
