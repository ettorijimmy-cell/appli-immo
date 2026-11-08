import { randomUUID } from "crypto";
import { BadRequestException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, garants, organisations, utilisateurs, type Database } from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuthModule } from "../auth/auth.module";
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

// Rattachement facultatif d'un garant au locataire dont il se porte caution
// (garants.locataire_id, migration 0077, 2026-11-08) : le locataire choisi
// doit être rattaché au même bail (lien bail_locataires non archivé), null
// efface le lien, la valeur déjà enregistrée reste acceptée telle quelle.
describe("GarantsService — « caution de » (locataire_id, intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let garantsService: GarantsService;
  let bailLocatairesService: BailLocatairesService;
  let contexte: <T>(fn: () => Promise<T>) => Promise<T>;

  let bailId: string;
  let autreBailId: string;
  let titulaireId: string;
  let colocataireId: string;
  let lienColocataireId: string;
  let locataireAutreBailId: string;

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
        LocatairesModule,
        BauxModule,
        BailLocatairesModule,
        GarantsModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    garantsService = moduleRef.get(GarantsService);
    bailLocatairesService = moduleRef.get(BailLocatairesService);
    const bienService = moduleRef.get(BienService);
    const appartementsService = moduleRef.get(AppartementsService);
    const bauxService = moduleRef.get(BauxService);
    const locatairesService = moduleRef.get(LocatairesService);
    const requestContextService = moduleRef.get(RequestContextService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Caution De" })
      .returning();
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation!.id,
        email: `garants-caution-de-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "CautionDe",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    contexte = (fn) =>
      requestContextService.executerAvecContexte({ utilisateurId: user!.id, organisationId: organisation!.id }, fn);

    const bien = await bienService.create(user!.id, {
      type: "immeuble",
      proprietaireType: "personne_physique",
      nomProprietaire: "Propriétaire Caution De",
      nom: "Immeuble Caution De",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const creerBail = async (numero: string): Promise<string> => {
      const appartement = await appartementsService.create({
        bienId: bien.id,
        numero,
        type: "T3",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel"
      });
      const bail = await bauxService.create({ appartementId: appartement.id, typeBail: "vide", dateDebut: "2026-01-01" });
      return bail.id;
    };
    bailId = await creerBail("1");
    autreBailId = await creerBail("2");

    titulaireId = (await locatairesService.create(user!.id, { nom: "Bernard", prenom: "Lucie" })).id;
    colocataireId = (await locatairesService.create(user!.id, { nom: "Petit", prenom: "Hugo" })).id;
    locataireAutreBailId = (await locatairesService.create(user!.id, { nom: "Ailleurs", prenom: "Nina" })).id;
    await bailLocatairesService.create({ bailId, locataireId: titulaireId, role: "titulaire" });
    lienColocataireId = (await bailLocatairesService.create({ bailId, locataireId: colocataireId, role: "colocataire" })).id;
    await bailLocatairesService.create({ bailId: autreBailId, locataireId: locataireAutreBailId, role: "titulaire" });
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  async function locataireIdEnBase(garantId: string): Promise<string | null | undefined> {
    const [ligne] = await db.select().from(garants).where(eq(garants.id, garantId));
    return ligne?.locataireId;
  }

  it("création sans locataire : non précisé (null)", async () => {
    const garant = await contexte(() =>
      garantsService.create({ bailId, nom: "Durand", prenom: "Claire", typeGarantie: "personne_physique" })
    );
    expect(garant.locataireId).toBeNull();
    expect(await locataireIdEnBase(garant.id)).toBeNull();
  });

  it("création rattachée à un locataire du bail", async () => {
    const garant = await contexte(() =>
      garantsService.create({
        bailId,
        nom: "Durand",
        prenom: "Claire",
        typeGarantie: "personne_physique",
        locataireId: colocataireId
      })
    );
    expect(garant.locataireId).toBe(colocataireId);
    expect(await locataireIdEnBase(garant.id)).toBe(colocataireId);
  });

  it("refuse à la création un locataire rattaché à un autre bail, sans insérer de garant", async () => {
    await expect(
      contexte(() =>
        garantsService.create({
          bailId,
          nom: "Durand",
          prenom: "Claire",
          typeGarantie: "personne_physique",
          locataireId: locataireAutreBailId
        })
      )
    ).rejects.toThrow(new BadRequestException("Le locataire choisi pour « Caution de » n'est pas rattaché à ce bail."));
    expect(await db.select().from(garants).where(eq(garants.bailId, bailId))).toHaveLength(0);
  });

  it("refuse à la création un locataire qui a quitté le bail (lien archivé)", async () => {
    await bailLocatairesService.archive(lienColocataireId);
    await expect(
      contexte(() =>
        garantsService.create({
          bailId,
          nom: "Durand",
          prenom: "Claire",
          typeGarantie: "personne_physique",
          locataireId: colocataireId
        })
      )
    ).rejects.toThrow(BadRequestException);
  });

  it("refuse à la création un identifiant de locataire inexistant", async () => {
    await expect(
      contexte(() =>
        garantsService.create({
          bailId,
          nom: "Durand",
          prenom: "Claire",
          typeGarantie: "personne_physique",
          locataireId: randomUUID()
        })
      )
    ).rejects.toThrow(BadRequestException);
  });

  it("modification : change de locataire, puis null efface le lien", async () => {
    const garant = await contexte(() =>
      garantsService.create({ bailId, nom: "Durand", prenom: "Claire", typeGarantie: "personne_physique", locataireId: titulaireId })
    );
    const change = await contexte(() => garantsService.update(garant.id, { locataireId: colocataireId }));
    expect(change.locataireId).toBe(colocataireId);

    const efface = await contexte(() => garantsService.update(garant.id, { locataireId: null }));
    expect(efface.locataireId).toBeNull();
    expect(await locataireIdEnBase(garant.id)).toBeNull();
  });

  it("modification : refuse un locataire d'un autre bail et laisse la valeur en place", async () => {
    const garant = await contexte(() =>
      garantsService.create({ bailId, nom: "Durand", prenom: "Claire", typeGarantie: "personne_physique", locataireId: titulaireId })
    );
    await expect(
      contexte(() => garantsService.update(garant.id, { locataireId: locataireAutreBailId }))
    ).rejects.toThrow(BadRequestException);
    expect(await locataireIdEnBase(garant.id)).toBe(titulaireId);
  });

  it("modification : la valeur déjà enregistrée reste acceptée même si le locataire a quitté le bail", async () => {
    const garant = await contexte(() =>
      garantsService.create({ bailId, nom: "Durand", prenom: "Claire", typeGarantie: "personne_physique", locataireId: colocataireId })
    );
    await bailLocatairesService.archive(lienColocataireId);

    const modifie = await contexte(() =>
      garantsService.update(garant.id, { telephone: "0611111111", locataireId: colocataireId })
    );
    expect(modifie).toMatchObject({ telephone: "0611111111", locataireId: colocataireId });
  });

  it("modification sans la clé locataireId : le lien reste inchangé", async () => {
    const garant = await contexte(() =>
      garantsService.create({ bailId, nom: "Durand", prenom: "Claire", typeGarantie: "personne_physique", locataireId: titulaireId })
    );
    const modifie = await contexte(() => garantsService.update(garant.id, { telephone: "0611111111" }));
    expect(modifie.locataireId).toBe(titulaireId);
  });
});
