import { randomUUID } from "crypto";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  alertes,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  documents,
  equipements,
  organisations,
  paiements,
  sinistre,
  utilisateurs,
  type Database
} from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { BauxModule } from "../baux/baux.module";
import { BauxService } from "../baux/baux.service";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { SinistresModule } from "../sinistres/sinistres.module";
import { SinistresService } from "../sinistres/sinistres.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import type { AlerteType } from "./alertes-config.service";
import { AlertesJobService } from "./alertes-job.service";
import { AlertesModule } from "./alertes.module";
import { AlertesService } from "./alertes.service";

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  bailId: string;
  paiementId: string;
  equipementId: string;
  documentId: string;
  sinistreId: string;
}

// Scoping multi-organisation d'AlertesService (audit 2026-10-03,
// docs/backlog.md — `alertes` avait été explicitement exclue du chantier
// de scoping d'origine faute de colonne/FK directe vers une organisation).
// Résolution polymorphe déléguée à OrganisationResolutionService, partagée
// avec DocumentsService (voir documents-scoping.integration.spec.ts pour
// le même principe appliqué aux 11 entiteType de documents). Une seule
// exécution du job (hors contexte HTTP, global — comme en production)
// génère les 6 types d'alertes pour les deux organisations, puis chaque
// type est vérifié séparément en consultation (findAll) et en écriture
// (traiter/ignorer).
describe("AlertesService — scoping par organisation, 5 chemins de résolution (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let sinistresService: SinistresService;
  let alertesJobService: AlertesJobService;
  let alertesService: AlertesService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Alertes Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `alertes-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `Scoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    const userId = user.id;

    const sci = await scisService.create(userId, {
      nom: `SCI Alertes Scoping ${suffixe}`,
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: `Immeuble Alertes Scoping ${suffixe}`,
      adresse: "1 rue des Alertes",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: suffixe,
      type: "T2",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel",
      loyerReference: "800.00"
    });
    const bail = await bauxService.create({
      appartementId: appartement.id,
      typeBail: "vide",
      dateDebut: "2026-01-01",
      loyerMensuel: "800.00",
      jourEcheance: 5,
      dateFin: "2026-07-20"
    });
    await bauxService.activer(bail.id);

    const [paiement] = await db
      .insert(paiements)
      .values({ bailId: bail.id, type: "loyer", montant: "800.00", dateEcheance: "2026-06-05" })
      .returning();
    if (!paiement) {
      throw new Error("Échec de l'insertion du paiement de test");
    }

    const [equipement] = await db
      .insert(equipements)
      .values({
        appartementId: appartement.id,
        type: "chaudiere",
        dateDernierEntretien: "2025-06-01",
        intervalleEntretienMois: 12
      })
      .returning();
    if (!equipement) {
      throw new Error("Échec de l'insertion de l'équipement de test");
    }

    const [document] = await db
      .insert(documents)
      .values({
        entiteType: "appartement",
        entiteId: appartement.id,
        categorie: "diagnostic",
        dateExpiration: "2026-06-01",
        nomFichier: `diagnostic-${suffixe}.pdf`,
        mimeType: "application/pdf",
        tailleOctets: 100,
        cheminStockage: "x"
      })
      .returning();
    if (!document) {
      throw new Error("Échec de l'insertion du document de test");
    }

    const sinistreCree = await sinistresService.create(userId, {
      type: "degat_eaux",
      bienId: bien.id,
      dateDeclaration: "2026-06-01"
    });
    await db
      .update(sinistre)
      .set({ dateChangementStatut: new Date("2026-06-01T00:00:00Z") })
      .where(eq(sinistre.id, sinistreCree.id));

    return {
      organisationId: organisation.id,
      userId,
      bailId: bail.id,
      paiementId: paiement.id,
      equipementId: equipement.id,
      documentId: document.id,
      sinistreId: sinistreCree.id
    };
  }

  beforeEach(async () => {
    db = await begin();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        CommonModule,
        DatabaseModule,
        EncryptionModule,
        AuditModule,
        UsersModule,
        AuthModule,
        ScisModule,
        BienModule,
        AppartementsModule,
        BauxModule,
        SinistresModule,
        AlertesModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    bauxService = moduleRef.get(BauxService);
    sinistresService = moduleRef.get(SinistresService);
    alertesJobService = moduleRef.get(AlertesJobService);
    alertesService = moduleRef.get(AlertesService);
    requestContextService = moduleRef.get(RequestContextService);

    orgA = await creerFixtureOrganisation("A");
    orgB = await creerFixtureOrganisation("B");

    // Un seul passage, global, hors contexte HTTP — comme en production
    // (AlertesJobService itère volontairement sur toutes les organisations,
    // confirmé par l'audit 2026-10-03 : aucun appel à findAll/changerStatut).
    await alertesJobService.genererAlertes("2026-07-01");
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  async function trouverAlerteHorsContexte(type: AlerteType, entiteId: string) {
    const toutes = await alertesService.findAll({ type });
    const trouvee = toutes.find((a) => a.entiteId === entiteId);
    if (!trouvee) {
      throw new Error(`Alerte ${type} introuvable pour l'entité ${entiteId}`);
    }
    return trouvee;
  }

  const cas: { type: AlerteType; champ: keyof FixtureOrganisation; libelle: string }[] = [
    { type: "bail_fin_proche", champ: "bailId", libelle: "bail_fin_proche (baux -> appartements -> bien)" },
    { type: "impaye", champ: "paiementId", libelle: "impaye (paiements -> baux -> appartements -> bien)" },
    { type: "entretien_equipement", champ: "equipementId", libelle: "entretien_equipement (equipements -> appartements -> bien)" },
    { type: "document_expire", champ: "documentId", libelle: "document_expire (résolution polymorphe documents, identique document_expire_proche)" },
    { type: "sinistre_stagnation", champ: "sinistreId", libelle: "sinistre_stagnation (colonne organisationId directe)" }
  ];

  for (const { type, champ, libelle } of cas) {
    describe(libelle, () => {
      it("findAll() : visible pour son organisation, invisible pour l'autre", async () => {
        const alerteA = await trouverAlerteHorsContexte(type, orgA[champ]);
        const alerteB = await trouverAlerteHorsContexte(type, orgB[champ]);

        const visiblesA = await requestContextService.executerAvecContexte(
          { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
          () => alertesService.findAll({ type })
        );
        expect(visiblesA.map((a) => a.id)).toContain(alerteA.id);
        expect(visiblesA.map((a) => a.id)).not.toContain(alerteB.id);

        const visiblesB = await requestContextService.executerAvecContexte(
          { utilisateurId: orgB.userId, organisationId: orgB.organisationId },
          () => alertesService.findAll({ type })
        );
        expect(visiblesB.map((a) => a.id)).toContain(alerteB.id);
        expect(visiblesB.map((a) => a.id)).not.toContain(alerteA.id);
      });

      it("traiter() : 404 cross-org, sans effet de bord", async () => {
        const alerteB = await trouverAlerteHorsContexte(type, orgB[champ]);

        await expect(
          requestContextService.executerAvecContexte(
            { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
            () => alertesService.traiter(alerteB.id)
          )
        ).rejects.toThrow(NotFoundException);

        const [inchangee] = await db.select().from(alertes).where(eq(alertes.id, alerteB.id));
        expect(inchangee?.statut).toBe("active");
      });

      it("ignorer() : 404 cross-org, sans effet de bord", async () => {
        const alerteB = await trouverAlerteHorsContexte(type, orgB[champ]);

        await expect(
          requestContextService.executerAvecContexte(
            { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
            () => alertesService.ignorer(alerteB.id)
          )
        ).rejects.toThrow(NotFoundException);

        const [inchangee] = await db.select().from(alertes).where(eq(alertes.id, alerteB.id));
        expect(inchangee?.statut).toBe("active");
      });
    });
  }

  describe("cas génériques (indépendants du type)", () => {
    it("traiter() : 404 sur un id inexistant", async () => {
      await expect(
        requestContextService.executerAvecContexte(
          { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
          () => alertesService.traiter(randomUUID())
        )
      ).rejects.toThrow(NotFoundException);
    });

    it("ignorer() : 404 sur un id inexistant", async () => {
      await expect(
        requestContextService.executerAvecContexte(
          { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
          () => alertesService.ignorer(randomUUID())
        )
      ).rejects.toThrow(NotFoundException);
    });

    it("findAll() hors contexte HTTP (organisationId absent) : aucun filtrage, comportement préexistant préservé", async () => {
      const alerteA = await trouverAlerteHorsContexte("bail_fin_proche", orgA.bailId);
      const alerteB = await trouverAlerteHorsContexte("bail_fin_proche", orgB.bailId);

      const toutes = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        alertesService.findAll({ type: "bail_fin_proche" })
      );
      expect(toutes.map((a) => a.id)).toContain(alerteA.id);
      expect(toutes.map((a) => a.id)).toContain(alerteB.id);
    });

    it("traiter() hors contexte HTTP (organisationId absent) : aucune vérification d'appartenance, comportement préexistant préservé", async () => {
      const alerteB = await trouverAlerteHorsContexte("bail_fin_proche", orgB.bailId);

      const traitee = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        alertesService.traiter(alerteB.id)
      );
      expect(traitee.statut).toBe("traitee");
    });
  });
});
