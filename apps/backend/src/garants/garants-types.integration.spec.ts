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
import { GarantsService, NOM_GARANT_VISALE } from "./garants.service";

// Chantier garants complet (2026-11-08), commit 3 : types de garant à la
// saisie et passage d'un type à l'autre (GarantsService), assurance loyers
// impayés sur le bail, statut d'études du locataire.
describe("Garants selon leur type, assurance et statut d'études (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let garantsService: GarantsService;
  let bauxService: BauxService;
  let locatairesService: LocatairesService;
  let contexte: <T>(fn: () => Promise<T>) => Promise<T>;
  let userId: string;
  let organisationId: string;
  let bailId: string;
  let locataireId: string;

  const identiteComplete = {
    email: "claire@example.com",
    telephone: "0600000001",
    adresse: "8 rue de la Caution",
    codePostal: "69002",
    ville: "Lyon",
    dateNaissance: "1965-03-20",
    lieuNaissance: "Lyon",
    nationalite: "Française"
  };

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
    bauxService = moduleRef.get(BauxService);
    locatairesService = moduleRef.get(LocatairesService);
    const requestContextService = moduleRef.get(RequestContextService);

    const [organisation] = await db.insert(organisations).values({ type: "particulier", nom: "Organisation Types Garants" }).returning();
    organisationId = organisation!.id;
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId,
        email: `garants-types-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Types",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    userId = user!.id;
    contexte = (fn) => requestContextService.executerAvecContexte({ utilisateurId: userId, organisationId }, fn);

    const bien = await moduleRef.get(BienService).create(userId, {
      type: "maison",
      proprietaireType: "personne_physique",
      nomProprietaire: "Propriétaire Types",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const appartement = await moduleRef.get(AppartementsService).create({
      bienId: bien.id,
      numero: "1",
      type: "T3",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    bailId = (await bauxService.create({ appartementId: appartement.id, typeBail: "vide", dateDebut: "2026-01-01" })).id;
    locataireId = (await locatairesService.create(userId, { nom: "Bernard", prenom: "Lucie" })).id;
    await moduleRef.get(BailLocatairesService).create({ bailId, locataireId, role: "titulaire" });
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  async function ligneEnBase(garantId: string) {
    const [ligne] = await db.select().from(garants).where(eq(garants.id, garantId));
    return ligne!;
  }

  describe("création", () => {
    it("caution personne physique : comportement inchangé, aucun numéro Visale", async () => {
      const garant = await contexte(() =>
        garantsService.create({
          bailId,
          typeGarantie: "personne_physique",
          nom: "Durand",
          prenom: "Claire",
          numeroContratVisale: "V-IGNORE",
          ...identiteComplete
        })
      );
      expect(garant).toMatchObject({ nom: "Durand", prenom: "Claire", numeroContratVisale: null, ville: "Lyon" });
    });

    it("garantie Visale : nom imposé, prénom et champs de personne vidés, numéro et contact conservés", async () => {
      const garant = await contexte(() =>
        garantsService.create({
          bailId,
          typeGarantie: "garantie_visale",
          nom: "Nom envoyé ignoré",
          prenom: "Prénom envoyé ignoré",
          locataireId,
          numeroContratVisale: "V123456789",
          ...identiteComplete
        })
      );
      expect(await ligneEnBase(garant.id)).toMatchObject({
        nom: NOM_GARANT_VISALE,
        prenom: null,
        adresse: null,
        codePostal: null,
        ville: null,
        dateNaissance: null,
        lieuNaissance: null,
        nationalite: null,
        locataireId: null,
        numeroContratVisale: "V123456789",
        email: "claire@example.com",
        telephone: "0600000001"
      });
    });

    it("garantie Visale sans numéro : acceptée à la saisie (exigé seulement à la génération)", async () => {
      const garant = await contexte(() => garantsService.create({ bailId, typeGarantie: "garantie_visale" }));
      expect(garant).toMatchObject({ nom: NOM_GARANT_VISALE, prenom: null, numeroContratVisale: null });
    });
  });

  describe("modification et changement de type", () => {
    async function creerCaution() {
      return contexte(() =>
        garantsService.create({ bailId, typeGarantie: "personne_physique", nom: "Durand", prenom: "Claire", locataireId, ...identiteComplete })
      );
    }

    it("caution → Visale : nom imposé, champs de personne et « Caution de » vidés", async () => {
      const caution = await creerCaution();
      await contexte(() =>
        garantsService.update(caution.id, { typeGarantie: "garantie_visale", numeroContratVisale: "V0001" })
      );
      expect(await ligneEnBase(caution.id)).toMatchObject({
        typeGarantie: "garantie_visale",
        nom: NOM_GARANT_VISALE,
        prenom: null,
        dateNaissance: null,
        nationalite: null,
        adresse: null,
        locataireId: null,
        numeroContratVisale: "V0001",
        email: "claire@example.com"
      });
    });

    it("Visale → caution sans nom ni prénom : refusé, rien n'est modifié", async () => {
      const visale = await contexte(() =>
        garantsService.create({ bailId, typeGarantie: "garantie_visale", numeroContratVisale: "V0001" })
      );
      await expect(
        contexte(() => garantsService.update(visale.id, { typeGarantie: "personne_physique", prenom: "Claire" }))
      ).rejects.toThrow(
        new BadRequestException("Passage en caution personne physique : nom et prénom de la caution requis.")
      );
      expect(await ligneEnBase(visale.id)).toMatchObject({ typeGarantie: "garantie_visale", numeroContratVisale: "V0001" });
    });

    it("Visale → caution avec nom et prénom : numéro Visale effacé", async () => {
      const visale = await contexte(() =>
        garantsService.create({ bailId, typeGarantie: "garantie_visale", numeroContratVisale: "V0001" })
      );
      const caution = await contexte(() =>
        garantsService.update(visale.id, { typeGarantie: "personne_physique", nom: "Durand", prenom: "Claire" })
      );
      expect(caution).toMatchObject({ typeGarantie: "personne_physique", nom: "Durand", prenom: "Claire", numeroContratVisale: null });
    });

    it("Visale sans changement de type : nom et prénom envoyés ignorés, numéro modifiable", async () => {
      const visale = await contexte(() =>
        garantsService.create({ bailId, typeGarantie: "garantie_visale", numeroContratVisale: "V0001" })
      );
      await contexte(() =>
        garantsService.update(visale.id, { nom: "Autre nom", prenom: "Autre", numeroContratVisale: "V0002", dateNaissance: "1980-01-01" })
      );
      expect(await ligneEnBase(visale.id)).toMatchObject({
        nom: NOM_GARANT_VISALE,
        prenom: null,
        dateNaissance: null,
        numeroContratVisale: "V0002"
      });
    });

    it("caution sans changement de type : un numéro Visale envoyé n'est jamais écrit", async () => {
      const caution = await creerCaution();
      await contexte(() => garantsService.update(caution.id, { numeroContratVisale: "V0001", telephone: "0611111111" }));
      expect(await ligneEnBase(caution.id)).toMatchObject({ numeroContratVisale: null, telephone: "0611111111" });
    });

    it("ligne « autre » existante : lisible et modifiable sans changer de type", async () => {
      const [autre] = await db
        .insert(garants)
        .values({ bailId, organisationId, nom: "Garantie bancaire", prenom: null, typeGarantie: "autre" })
        .returning();
      expect((await contexte(() => garantsService.findById(autre!.id))).typeGarantie).toBe("autre");
      const modifie = await contexte(() => garantsService.update(autre!.id, { telephone: "0612345678" }));
      expect(modifie).toMatchObject({ typeGarantie: "autre", telephone: "0612345678" });
    });
  });

  describe("bail : assurance loyers impayés", () => {
    it("faux par défaut, renseigné à la création, modifiable", async () => {
      expect((await contexte(() => bauxService.findById(bailId))).assuranceLoyersImpayes).toBe(false);
      const [appartementId] = [(await contexte(() => bauxService.findById(bailId))).appartementId];
      await contexte(() => bauxService.archive(bailId));
      const assure = await contexte(() =>
        bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-02-01", assuranceLoyersImpayes: true })
      );
      expect(assure.assuranceLoyersImpayes).toBe(true);
      const modifie = await contexte(() => bauxService.update(assure.id, { assuranceLoyersImpayes: false }));
      expect(modifie.assuranceLoyersImpayes).toBe(false);
    });
  });

  describe("locataire : statut d'études", () => {
    it("non_renseigne par défaut, renseigné à la création, modifiable", async () => {
      expect((await contexte(() => locatairesService.findById(locataireId))).statutEtudes).toBe("non_renseigne");
      const etudiant = await contexte(() =>
        locatairesService.create(userId, { nom: "Petit", prenom: "Hugo", statutEtudes: "etudiant_non_boursier" })
      );
      expect(etudiant.statutEtudes).toBe("etudiant_non_boursier");
      const modifie = await contexte(() => locatairesService.update(etudiant.id, { statutEtudes: "apprenti" }));
      expect(modifie.statutEtudes).toBe("apprenti");
    });
  });
});
