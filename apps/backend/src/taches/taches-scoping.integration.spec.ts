import { randomUUID } from "crypto";
import path from "path";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  bailLocataires,
  baux,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  locataires,
  organisations,
  paiements,
  revisionLoyer,
  tache,
  utilisateurs,
  versements,
  type Database
} from "db";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { SmtpEnvoiService } from "../messagerie/smtp-envoi.service";
import { QuittanceDocumentDocxService } from "../quittance-document-docx/quittance-document-docx.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { TachesModule } from "./taches.module";
import { TachesService } from "./taches.service";

// Fixture minimale committée réutilisée pour TachesModule (dépendance
// transitive de QuittanceDocumentDocxModule) — jamais utilisée ici
// puisque seul findById() est exercé, mais requise pour que le module se
// compile (même chemin que taches.integration.spec.ts).
process.env["QUITTANCE_DOCUMENT_DOCX_TEMPLATE_PATH"] = path.join(
  __dirname,
  "..",
  "quittance-document-docx",
  "__fixtures__",
  "modele-quittance-test.docx"
);

interface FixtureOrganisation {
  organisationId: string;
  tacheId: string;
}

// Sous-commit 5a (chantier scoping multi-organisation, 2026-09-18) :
// TachesService.findById() ne vérifiait jusqu'ici jamais l'appartenance à
// l'organisation. organisationId est une colonne directe : contrôle par
// simple comparaison. Aucun autre appelant interne (vérifié par grep —
// seul TachesController.findOne l'appelle). Aucune méthode create()
// n'existe sur ce service (les tâches naissent de TachesJobService ou
// d'une génération liée aux alertes) — insertion directe en base pour la
// fixture, comme pour messages-communication-scoping.
//
// appliquerRevision()/envoyerNotification() faisaient chacune leur propre
// requête brute sur `id`, sans passer par findById() — non protégées par
// ce sous-commit (Catégorie C, audit séparé). Corrigé en Priorité 1
// (2026-09-18) via un helper privé partagé, resoudreTacheAvecAppartenance()
// : voir le describe dédié plus bas dans ce fichier pour leur couverture
// cross-org.
describe("TachesService.findById — contrôle d'appartenance à l'organisation (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let tachesService: TachesService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Taches Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `taches-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `TachesScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }

    const [tacheRow] = await db
      .insert(tache)
      .values({ type: "autre", origine: "manuelle", organisationId: organisation.id })
      .returning();
    if (!tacheRow) {
      throw new Error("Échec de l'insertion de la tâche de test");
    }

    return { organisationId: organisation.id, tacheId: tacheRow.id };
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
        TachesModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    tachesService = moduleRef.get(TachesService);
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
    return requestContextService.executerAvecContexte({ utilisateurId: null, organisationId: orgA.organisationId }, fn);
  }
  function contexteOrgB<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte({ utilisateurId: null, organisationId: orgB.organisationId }, fn);
  }

  it("réussit normalement quand la tâche appartient à l'organisation appelante", async () => {
    const tacheDto = await contexteOrgA(() => tachesService.findById(orgA.tacheId));
    expect(tacheDto.id).toBe(orgA.tacheId);
  });

  it("404 sur le tacheId d'une autre organisation", async () => {
    await expect(contexteOrgB(() => tachesService.findById(orgA.tacheId))).rejects.toThrow(NotFoundException);
  });

  it("404 sur un tacheId inexistant", async () => {
    await expect(contexteOrgA(() => tachesService.findById(randomUUID()))).rejects.toThrow(NotFoundException);
  });

  it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
    const tacheDto = await requestContextService.executerAvecContexte({ utilisateurId: null }, () =>
      tachesService.findById(orgA.tacheId)
    );
    expect(tacheDto.id).toBe(orgA.tacheId);
  });
});

interface FixtureOrganisationEcriture {
  organisationId: string;
  userId: string;
  bailId: string;
  paiementId: string;
  locataireId: string;
  tacheRevisionId: string;
  tacheQuittanceId: string;
}

// Priorité 1, Catégorie C (chantier scoping multi-organisation, 2026-09-18) :
// appliquerRevision() et envoyerNotification() faisaient chacune leur propre
// select brut sur `id`, sans jamais passer par findById() — donc pas
// protégées par le Sous-commit 5a malgré la colonne organisationId directe
// sur `tache`. Avant ce correctif, un tacheId d'une autre organisation
// menait respectivement à : réécrire le loyer réel d'un bail étranger et
// fabriquer un historique de révision falsifié (appliquerRevision), ou
// envoyer un e-mail réel avec un document financier étranger en pièce
// jointe (envoyerNotification). Les deux méthodes utilisent désormais
// resoudreTacheAvecAppartenance(), le même helper privé que findById()
// ci-dessus. SmtpEnvoiService est remplacé par un double de test (jamais un
// vrai envoi SMTP dans les tests automatisés) ; QuittanceDocumentDocxService
// reste le vrai service, avec un spy sur genererDocumentQuittanceDocx pour
// prouver qu'aucun document n'est généré quand le contrôle rejette l'accès.
describe("TachesService.appliquerRevision / envoyerNotification — contrôle d'appartenance (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let tachesService: TachesService;
  let requestContextService: RequestContextService;
  let quittanceDocumentDocxService: QuittanceDocumentDocxService;
  let smtpEnvoiServiceDouble: { envoyerEmail: ReturnType<typeof vi.fn> };

  let orgA: FixtureOrganisationEcriture;
  let orgB: FixtureOrganisationEcriture;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisationEcriture> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Taches Ecriture Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `taches-ecriture-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `TachesEcritureScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    const userId = user.id;
    const organisationId = organisation.id;

    const sci = await scisService.create(userId, {
      nom: `SCI Taches Ecriture Scoping ${suffixe}`,
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: `Immeuble Taches Ecriture Scoping ${suffixe}`,
      adresse: "1 rue de la Révision",
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
      modeEauChaude: "individuel"
    });
    const bail = await bauxService.create({
      appartementId: appartement.id,
      typeBail: "vide",
      dateDebut: "1998-06-15",
      loyerMensuel: "800.00",
      jourEcheance: 5
    });

    const [locataire] = await db
      .insert(locataires)
      .values({ nom: "Devos", prenom: `Ilan${suffixe}`, email: `ilan.devos.${suffixe}@example.com`, organisationId })
      .returning();
    if (!locataire) {
      throw new Error("Échec de l'insertion du locataire de test");
    }
    await db.insert(bailLocataires).values({ bailId: bail.id, locataireId: locataire.id, role: "titulaire" });

    // statut 'paye' + loyerHorsCharges/charges figées + versement associé :
    // requis par QuittanceDocumentDocxService.genererDocumentQuittanceDocx
    // (appelé par envoyerNotification pour une tâche quittance_mensuelle)
    // pour que le test "réussit normalement" (chemin légitime, même
    // organisation) génère effectivement le docx, pas seulement pour le
    // test de rejet cross-org qui n'atteint jamais ce code.
    const [paiement] = await db
      .insert(paiements)
      .values({
        bailId: bail.id,
        type: "loyer",
        statut: "paye",
        montant: "800.00",
        dateEcheance: "2026-02-05",
        loyerHorsCharges: "800.00",
        charges: "0.00"
      })
      .returning();
    if (!paiement) {
      throw new Error("Échec de l'insertion du paiement de test");
    }
    await db.insert(versements).values({ paiementId: paiement.id, montant: "800.00", mode: "virement", dateVersement: "2026-02-05" });

    // Tâche prête à être appliquée : mêmes métadonnées qu'une tâche
    // réellement générée par TachesJobService.genererTachesRevisionLoyer
    // (voir taches.integration.spec.ts), insérée directement pour isoler
    // le contrôle d'appartenance de la logique de génération elle-même.
    const [tacheRevision] = await db
      .insert(tache)
      .values({
        type: "revision_loyer",
        origine: "planifiee",
        statut: "a_faire",
        bailId: bail.id,
        dateEcheance: "1999-06-15",
        organisationId,
        metadata: {
          trimestreReference: 2,
          anneeReference: 1999,
          indiceReferenceValeur: "145.50",
          indicePrecedentValeur: "143.00"
        }
      })
      .returning();
    if (!tacheRevision) {
      throw new Error("Échec de l'insertion de la tâche de révision de test");
    }

    const [tacheQuittance] = await db
      .insert(tache)
      .values({
        type: "quittance_mensuelle",
        origine: "planifiee",
        statut: "a_faire",
        bailId: bail.id,
        paiementId: paiement.id,
        locataireId: locataire.id,
        organisationId,
        metadata: { notificationObjet: "Quittance de loyer", notificationCorps: `Bonjour Ilan${suffixe}, voici votre quittance.` }
      })
      .returning();
    if (!tacheQuittance) {
      throw new Error("Échec de l'insertion de la tâche de quittance de test");
    }

    return {
      organisationId,
      userId,
      bailId: bail.id,
      paiementId: paiement.id,
      locataireId: locataire.id,
      tacheRevisionId: tacheRevision.id,
      tacheQuittanceId: tacheQuittance.id
    };
  }

  beforeEach(async () => {
    db = await begin();
    smtpEnvoiServiceDouble = { envoyerEmail: vi.fn(async () => undefined) };

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
        TachesModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .overrideProvider(SmtpEnvoiService)
      .useValue(smtpEnvoiServiceDouble)
      .compile();

    scisService = moduleRef.get(ScisService);
    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    bauxService = moduleRef.get(BauxService);
    tachesService = moduleRef.get(TachesService);
    requestContextService = moduleRef.get(RequestContextService);
    quittanceDocumentDocxService = moduleRef.get(QuittanceDocumentDocxService);

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

  describe("appliquerRevision", () => {
    it("réussit normalement quand la tâche appartient à l'organisation appelante", async () => {
      const resultat = await contexteOrgA(() => tachesService.appliquerRevision(orgA.tacheRevisionId, "810.00"));
      expect(resultat.statut).toBe("en_cours");
    });

    it("404 sur le tacheId d'une autre organisation, sans jamais créer l'historique ni modifier le loyer du bail étranger", async () => {
      await expect(
        contexteOrgB(() => tachesService.appliquerRevision(orgA.tacheRevisionId, "999.00"))
      ).rejects.toThrow(NotFoundException);

      const lignesHistorique = await db.select().from(revisionLoyer).where(eq(revisionLoyer.bailId, orgA.bailId));
      expect(lignesHistorique).toHaveLength(0);

      const [bailInchange] = await db.select().from(baux).where(eq(baux.id, orgA.bailId));
      expect(bailInchange?.loyerMensuel).toBe("800.00");
    });

    it("404 sur un tacheId inexistant", async () => {
      await expect(contexteOrgA(() => tachesService.appliquerRevision(randomUUID(), "999.00"))).rejects.toThrow(
        NotFoundException
      );
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const resultat = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        tachesService.appliquerRevision(orgA.tacheRevisionId, "810.00")
      );
      expect(resultat.statut).toBe("en_cours");
    });
  });

  describe("envoyerNotification", () => {
    it("réussit normalement quand la tâche appartient à l'organisation appelante", async () => {
      const resultat = await contexteOrgA(() => tachesService.envoyerNotification(orgA.tacheQuittanceId));
      expect(resultat.statut).toBe("fait");
      expect(smtpEnvoiServiceDouble.envoyerEmail).toHaveBeenCalledTimes(1);
    });

    it("404 sur le tacheId d'une autre organisation, sans jamais envoyer l'e-mail ni générer le document joint", async () => {
      const genererDocumentSpy = vi.spyOn(quittanceDocumentDocxService, "genererDocumentQuittanceDocx");

      await expect(
        contexteOrgB(() => tachesService.envoyerNotification(orgA.tacheQuittanceId))
      ).rejects.toThrow(NotFoundException);

      expect(smtpEnvoiServiceDouble.envoyerEmail).not.toHaveBeenCalled();
      expect(genererDocumentSpy).not.toHaveBeenCalled();

      const [tacheInchangee] = await db.select().from(tache).where(and(eq(tache.id, orgA.tacheQuittanceId)));
      expect(tacheInchangee?.statut).toBe("a_faire");
      expect(tacheInchangee?.dateCompletion).toBeNull();
    });

    it("404 sur un tacheId inexistant", async () => {
      await expect(contexteOrgA(() => tachesService.envoyerNotification(randomUUID()))).rejects.toThrow(
        NotFoundException
      );
      expect(smtpEnvoiServiceDouble.envoyerEmail).not.toHaveBeenCalled();
    });

    it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
      const resultat = await requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
        tachesService.envoyerNotification(orgA.tacheQuittanceId)
      );
      expect(resultat.statut).toBe("fait");
    });
  });
});
