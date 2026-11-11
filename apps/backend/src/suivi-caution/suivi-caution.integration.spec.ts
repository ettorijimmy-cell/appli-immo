import { randomUUID } from "crypto";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  bailLocataires,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  garantRemiseBail,
  journalAudit,
  organisations,
  scis,
  utilisateurs,
  type Database
} from "db";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { BailLocatairesModule } from "../bail-locataires/bail-locataires.module";
import { BailLocatairesService } from "../bail-locataires/bail-locataires.service";
import { BauxModule } from "../baux/baux.module";
import { BauxService } from "../baux/baux.service";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { dateDuJourParis } from "../common/date-paris";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { GarantsModule } from "../garants/garants.module";
import { GarantsService } from "../garants/garants.service";
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import {
  MESSAGE_DUREE_BAIL_INDETERMINEE,
  MESSAGE_SUIVI_RESERVE_CAUTION,
  SuiviCautionService
} from "./suivi-caution.service";
import { SuiviCautionModule } from "./suivi-caution.module";

interface Organisation {
  organisationId: string;
  userId: string;
}

describe("Suivi de la caution : remise du bail et fin d'engagement (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let locatairesService: LocatairesService;
  let garantsService: GarantsService;
  let bauxService: BauxService;
  let bailLocatairesService: BailLocatairesService;
  let suiviService: SuiviCautionService;
  let requestContextService: RequestContextService;
  let orgA: Organisation;
  let orgB: Organisation;

  async function creerOrganisation(suffixe: string): Promise<Organisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Suivi Caution ${suffixe}` })
      .returning();
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation!.id,
        email: `suivi-caution-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `Suivi${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    return { organisationId: organisation!.id, userId: user!.id };
  }

  const dans = <T>(fn: () => Promise<T>, org: Organisation = orgA): Promise<T> =>
    requestContextService.executerAvecContexte({ utilisateurId: org.userId, organisationId: org.organisationId }, fn);

  // Une écriture refusée par la base annule toute la transaction : chaque
  // tentative tourne dans son propre savepoint.
  function dansUnSavepoint(ecriture: (tx: Database) => Promise<unknown>): Promise<unknown> {
    return db.transaction((tx) => ecriture(tx as unknown as Database));
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
        ScisModule,
        BienModule,
        AppartementsModule,
        LocatairesModule,
        GarantsModule,
        BauxModule,
        BailLocatairesModule,
        SuiviCautionModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    locatairesService = moduleRef.get(LocatairesService);
    garantsService = moduleRef.get(GarantsService);
    bauxService = moduleRef.get(BauxService);
    bailLocatairesService = moduleRef.get(BailLocatairesService);
    suiviService = moduleRef.get(SuiviCautionService);
    requestContextService = moduleRef.get(RequestContextService);

    orgA = await creerOrganisation("A");
    orgB = await creerOrganisation("B");
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  // Bailleur SCI familiale, bail vide au 01/07/2026, un locataire (deux en
  // colocation), une caution rattachée au dernier.
  async function creerDossier(options: { colocation?: boolean; estFamiliale?: boolean | null } = {}) {
    return dans(async () => {
      const sci = await scisService.create(orgA.userId, {
        nom: "SCI des Tilleuls",
        regimeFiscal: "IR",
        adresse: "3 place du Marché",
        codePostal: "19100",
        ville: "Brive"
      });
      if (options.estFamiliale !== null) {
        await scisService.update(sci.id, { estFamiliale: options.estFamiliale ?? true });
      }
      const bien = await bienService.create(orgA.userId, {
        type: "immeuble",
        proprietaireType: "sci",
        sciId: sci.id,
        nom: "Immeuble des Tilleuls",
        adresse: "17 avenue du Test",
        codePostal: "19100",
        ville: "Brive",
        typeHabitat: "collectif",
        regimeJuridique: "copropriete"
      });
      const appartement = await appartementsService.create({
        bienId: bien.id,
        numero: "1",
        type: "T2",
        nombrePiecesPrincipales: 2,
        modeChauffage: "individuel",
        modeEauChaude: "individuel"
      });
      const bail = await bauxService.create({
        appartementId: appartement.id,
        typeBail: "vide",
        dateDebut: "2026-07-01",
        loyerMensuel: "650.00",
        provisionsCharges: "30.00",
        jourEcheance: 5
      });
      const titulaire = await locatairesService.create(orgA.userId, { nom: "Devos", prenom: "Ilan" });
      const lienTitulaire = await bailLocatairesService.create({ bailId: bail.id, locataireId: titulaire.id, role: "titulaire" });
      let garanti = titulaire;
      let lienGaranti = lienTitulaire;
      if (options.colocation) {
        garanti = await locatairesService.create(orgA.userId, { nom: "Roux", prenom: "Léa" });
        lienGaranti = await bailLocatairesService.create({ bailId: bail.id, locataireId: garanti.id, role: "colocataire" });
      }
      const caution = await garantsService.create({
        bailId: bail.id,
        typeGarantie: "personne_physique",
        nom: "Durand",
        prenom: "Claire",
        ...(options.colocation ? { locataireId: garanti.id } : {})
      });
      return { bail, sciId: sci.id, garanti, lienGaranti, caution };
    });
  }

  async function lignesRemise(garantId: string) {
    return db.select().from(garantRemiseBail).where(eq(garantRemiseBail.garantId, garantId));
  }

  async function erreurDe(promesse: Promise<unknown>): Promise<unknown> {
    try {
      await promesse;
    } catch (erreur) {
      return erreur;
    }
    throw new Error("Une erreur était attendue");
  }

  describe("remise du bail à la caution", () => {
    it("déclaration : ligne active, auteur et horodatage posés par le serveur, journal d'audit", async () => {
      const { caution } = await creerDossier();
      const avant = new Date();
      const resultat = await dans(() =>
        suiviService.declarerRemiseBail(caution.id, { dateRemise: "2026-06-20", mode: "main_propre" })
      );

      expect(resultat.historique).toEqual([]);
      expect(resultat.active).toMatchObject({ dateRemise: "2026-06-20", mode: "main_propre", declareePar: orgA.userId, archivedAt: null });
      expect(resultat.active!.declareeLe.getTime()).toBeGreaterThanOrEqual(avant.getTime() - 1000);

      const [ligne] = await lignesRemise(caution.id);
      expect(ligne?.organisationId).toBe(orgA.organisationId);
      const audit = await db
        .select()
        .from(journalAudit)
        .where(and(eq(journalAudit.entiteType, "garant_remise_bail"), eq(journalAudit.entiteId, ligne!.id)));
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: "creation",
        utilisateurId: orgA.userId,
        donneesAvant: null,
        donneesApres: { garantId: caution.id, dateRemise: "2026-06-20", mode: "main_propre" }
      });
    });

    it("date du jour acceptée ; date future refusée sans aucune écriture", async () => {
      const { caution } = await creerDossier();
      const erreur = await erreurDe(
        dans(() => suiviService.declarerRemiseBail(caution.id, { dateRemise: "2999-01-01", mode: "email" }))
      );
      expect(erreur).toBeInstanceOf(BadRequestException);
      expect((erreur as Error).message).toBe("La date de remise du bail à la caution ne peut pas être dans le futur.");
      expect(await lignesRemise(caution.id)).toHaveLength(0);

      const resultat = await dans(() =>
        suiviService.declarerRemiseBail(caution.id, { dateRemise: dateDuJourParis(), mode: "email" })
      );
      expect(resultat.active?.dateRemise).toBe(dateDuJourParis());
    });

    it("correction : l'active est archivée sans changer ses champs de fond, la nouvelle la remplace, historique dans l'ordre", async () => {
      const { caution } = await creerDossier();
      await dans(() => suiviService.declarerRemiseBail(caution.id, { dateRemise: "2026-06-20", mode: "main_propre" }));
      const [premiere] = await lignesRemise(caution.id);

      await dans(() => suiviService.declarerRemiseBail(caution.id, { dateRemise: "2026-06-21", mode: "lettre_recommandee" }));
      const resultat = await dans(() =>
        suiviService.declarerRemiseBail(caution.id, { dateRemise: "2026-06-22", mode: "courrier_simple" })
      );

      expect(resultat.active).toMatchObject({ dateRemise: "2026-06-22", mode: "courrier_simple" });
      expect(resultat.historique.map((d) => [d.dateRemise, d.mode])).toEqual([
        ["2026-06-21", "lettre_recommandee"],
        ["2026-06-20", "main_propre"]
      ]);
      expect(resultat.historique.every((d) => d.archivedAt !== null)).toBe(true);

      // Première déclaration : seuls archived_at et l'audit de ligne ont bougé.
      const [archivee] = await db.select().from(garantRemiseBail).where(eq(garantRemiseBail.id, premiere!.id));
      expect(archivee).toMatchObject({
        dateRemise: premiere!.dateRemise,
        mode: premiere!.mode,
        declareeLe: premiere!.declareeLe,
        declareePar: premiere!.declareePar,
        garantId: premiere!.garantId
      });
      expect(archivee!.archivedAt).not.toBeNull();
      expect(await lignesRemise(caution.id)).toHaveLength(3);

      // Le journal garde la déclaration remplacée.
      const [auditCorrection] = await db
        .select()
        .from(journalAudit)
        .where(and(eq(journalAudit.entiteType, "garant_remise_bail"), eq(journalAudit.entiteId, resultat.active!.id)));
      expect(auditCorrection?.donneesAvant).toMatchObject({ dateRemise: "2026-06-21", mode: "lettre_recommandee" });
    });

    it("triggers toujours respectés après une correction : ni modification, ni réactivation, ni suppression", async () => {
      const { caution } = await creerDossier();
      await dans(() => suiviService.declarerRemiseBail(caution.id, { dateRemise: "2026-06-20", mode: "main_propre" }));
      await dans(() => suiviService.declarerRemiseBail(caution.id, { dateRemise: "2026-06-21", mode: "email" }));
      const lignes = await lignesRemise(caution.id);
      const archivee = lignes.find((l) => l.archivedAt !== null)!;
      const active = lignes.find((l) => l.archivedAt === null)!;

      await expect(
        dansUnSavepoint((tx) => tx.update(garantRemiseBail).set({ dateRemise: "2026-01-01" }).where(eq(garantRemiseBail.id, active.id)))
      ).rejects.toThrow(/Modification interdite/);
      await expect(
        dansUnSavepoint((tx) => tx.update(garantRemiseBail).set({ archivedAt: null }).where(eq(garantRemiseBail.id, archivee.id)))
      ).rejects.toThrow(/Modification interdite/);
      await expect(
        dansUnSavepoint((tx) => tx.delete(garantRemiseBail).where(eq(garantRemiseBail.id, archivee.id)))
      ).rejects.toThrow(/Suppression interdite/);
      expect(await lignesRemise(caution.id)).toHaveLength(2);
    });

    it("lecture : rien de déclaré, puis déclaration active seule", async () => {
      const { caution } = await creerDossier();
      expect(await dans(() => suiviService.consulterRemiseBail(caution.id))).toEqual({ active: null, historique: [] });
      await dans(() => suiviService.declarerRemiseBail(caution.id, { dateRemise: "2026-06-20", mode: "email" }));
      const lecture = await dans(() => suiviService.consulterRemiseBail(caution.id));
      expect(lecture.active?.mode).toBe("email");
      expect(lecture.historique).toEqual([]);
    });

    it("garantie Visale : 400 en déclaration comme en lecture, aucune ligne", async () => {
      const { bail } = await creerDossier();
      const visale = await dans(() => garantsService.create({ bailId: bail.id, typeGarantie: "garantie_visale" }));
      for (const appel of <Array<() => Promise<unknown>>>[
        () => suiviService.declarerRemiseBail(visale.id, { dateRemise: "2026-06-20", mode: "email" }),
        () => suiviService.consulterRemiseBail(visale.id),
        () => suiviService.consulterEngagement(visale.id)
      ]) {
        const erreur = await erreurDe(dans(appel));
        expect(erreur).toBeInstanceOf(BadRequestException);
        expect((erreur as Error).message).toBe(MESSAGE_SUIVI_RESERVE_CAUTION);
      }
      expect(await lignesRemise(visale.id)).toHaveLength(0);
    });

    it("autre organisation ou garant inexistant : 404 (même message), aucune ligne", async () => {
      const { caution } = await creerDossier();
      for (const [garantId, org] of [
        [caution.id, orgB],
        [randomUUID(), orgA]
      ] as const) {
        for (const appel of <Array<() => Promise<unknown>>>[
          () => suiviService.declarerRemiseBail(garantId, { dateRemise: "2026-06-20", mode: "email" }),
          () => suiviService.consulterRemiseBail(garantId),
          () => suiviService.consulterEngagement(garantId)
        ]) {
          const erreur = await erreurDe(dans(appel, org));
          expect(erreur).toBeInstanceOf(NotFoundException);
          expect((erreur as Error).message).toBe("Garant introuvable");
        }
      }
      expect(await lignesRemise(caution.id)).toHaveLength(0);
    });

    it("garant retiré du bail : déclaration refusée (404), historique toujours lisible", async () => {
      const { caution } = await creerDossier();
      await dans(() => suiviService.declarerRemiseBail(caution.id, { dateRemise: "2026-06-20", mode: "email" }));
      await dans(() => garantsService.archive(caution.id));
      await expect(
        dans(() => suiviService.declarerRemiseBail(caution.id, { dateRemise: "2026-06-21", mode: "email" }))
      ).rejects.toThrow(NotFoundException);
      expect((await dans(() => suiviService.consulterRemiseBail(caution.id))).active?.dateRemise).toBe("2026-06-20");
    });
  });

  describe("fin d'engagement de la caution", () => {
    it("bail vide 3 ans au 01/07/2026 : jusqu'au 30/06/2035 (même date que l'acte), sans colocation", async () => {
      const { caution } = await creerDossier();
      expect(await dans(() => suiviService.consulterEngagement(caution.id))).toEqual({
        dateFinEngagement: "2035-06-30",
        motifIndisponible: null,
        colocation: null
      });
    });

    it("colocation : date d'effet du congé du colocataire garanti, + 6 mois au plus tard ; effacée, plus rien", async () => {
      const { caution, lienGaranti } = await creerDossier({ colocation: true });
      expect((await dans(() => suiviService.consulterEngagement(caution.id))).colocation).toBeNull();

      await dans(() => bailLocatairesService.update(lienGaranti.id, { dateEffetConge: "2027-03-15" }));
      expect((await dans(() => suiviService.consulterEngagement(caution.id))).colocation).toEqual({
        dateEffetConge: "2027-03-15",
        siRemplace: "2027-03-15",
        auPlusTard: "2027-09-15"
      });

      // Colocataire retiré du bail depuis : son congé compte toujours.
      await dans(() => bailLocatairesService.archive(lienGaranti.id));
      expect((await dans(() => suiviService.consulterEngagement(caution.id))).colocation?.auPlusTard).toBe("2027-09-15");

      await dans(() => bailLocatairesService.update(lienGaranti.id, { dateEffetConge: null }));
      expect((await dans(() => suiviService.consulterEngagement(caution.id))).colocation).toBeNull();
    });

    it("congé posé sur un autre colocataire : rien sur cette caution", async () => {
      const { bail, caution } = await creerDossier({ colocation: true });
      const [lienTitulaire] = await db
        .select()
        .from(bailLocataires)
        .where(and(eq(bailLocataires.bailId, bail.id), eq(bailLocataires.role, "titulaire")));
      await dans(() => bailLocatairesService.update(lienTitulaire!.id, { dateEffetConge: "2027-03-15" }));
      expect((await dans(() => suiviService.consulterEngagement(caution.id))).colocation).toBeNull();
    });

    it("SCI au caractère familial non renseigné : date non calculable, motif renvoyé", async () => {
      const { caution, sciId } = await creerDossier({ estFamiliale: null });
      const [sci] = await db.select({ estFamiliale: scis.estFamiliale }).from(scis).where(eq(scis.id, sciId));
      expect(sci?.estFamiliale).toBeNull();
      expect(await dans(() => suiviService.consulterEngagement(caution.id))).toEqual({
        dateFinEngagement: null,
        motifIndisponible: MESSAGE_DUREE_BAIL_INDETERMINEE,
        colocation: null
      });
    });
  });
});
