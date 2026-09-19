import { randomUUID } from "crypto";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  elementsInventaireMeuble,
  etatDesLieuxCles,
  etatDesLieuxCompteurs,
  etatDesLieuxEquipementsDivers,
  etatDesLieuxInventaire,
  etatDesLieuxPieceCuisine,
  etatDesLieuxPieceEntree,
  etatDesLieuxPieceSejour,
  etatDesLieuxPiecesAutre,
  etatDesLieuxPiecesChambre,
  etatDesLieuxPiecesSalleDeBain,
  etatDesLieuxPiecesWc,
  etatsDesLieux,
  organisations,
  utilisateurs,
  type Database
} from "db";
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
//
// Priorité 4 (chantier scoping multi-organisation, Catégorie C, 2026-09-19) :
// updateHeader() et les 11 submitX() (pièces, compteurs, clés, équipements
// divers, inventaire) passaient tous par verifierExiste(), qui ne
// vérifiait que l'existence de la ligne — jamais l'organisation. Ce sont
// des documents à valeur légale : une écriture par une autre organisation
// en corromprait le contenu source, même si la génération docx en sortie
// reste protégée (B3). Corrigé en fusionnant le contrôle d'appartenance
// dans verifierExiste() lui-même (même helper privé verifierAppartenance()
// que findById(), un seul point de vérité) — les 11 submitX() en héritent
// automatiquement puisqu'ils l'appelaient déjà tous en première ligne ;
// seul updateHeader() a reçu un appel explicite en plus. Vérifié par grep :
// verifierExiste() n'a aucun appelant interne en dehors de ces 11
// méthodes. Couverture ci-dessous : un test paramétré (une entrée par
// méthode) plutôt que 12 blocs quasi identiques — chaque cas prouve, pour
// le rejet cross-organisation, qu'aucune ligne n'a été écrite dans la
// section correspondante (les tables de section sont créées par upsert,
// donc "aucune ligne" est la preuve la plus forte possible pour un premier
// appel).
describe("EtatsDesLieuxService — contrôle d'appartenance à l'organisation (intégration Postgres réelle)", () => {
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

  describe("findById / findByBailId", () => {
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

  describe("updateHeader et les 11 submitX — contrôle d'appartenance hérité de verifierExiste()", () => {
    interface CasSection {
      nom: string;
      soumettre: (etatDesLieuxId: string) => Promise<unknown>;
      // Prouve qu'aucune écriture n'a eu lieu dans la section touchée par
      // cette méthode après un rejet cross-organisation.
      verifierAucuneEcriture: (etatDesLieuxId: string) => Promise<void>;
    }

    function casSections(): CasSection[] {
      return [
        {
          nom: "updateHeader",
          soumettre: (id) => etatsDesLieuxService.updateHeader(id, { dateEntree: "2026-08-01" }),
          verifierAucuneEcriture: async (id) => {
            const [entete] = await db.select().from(etatsDesLieux).where(eq(etatsDesLieux.id, id));
            expect(entete?.dateEntree).toBeNull();
          }
        },
        {
          nom: "submitPieceEntree",
          soumettre: (id) => etatsDesLieuxService.submitPieceEntree(id, { mur: { etatEntree: "B" } }),
          verifierAucuneEcriture: async (id) => {
            const lignes = await db
              .select()
              .from(etatDesLieuxPieceEntree)
              .where(eq(etatDesLieuxPieceEntree.etatDesLieuxId, id));
            expect(lignes).toHaveLength(0);
          }
        },
        {
          nom: "submitPieceSejour",
          soumettre: (id) => etatsDesLieuxService.submitPieceSejour(id, { mur: { etatEntree: "B" } }),
          verifierAucuneEcriture: async (id) => {
            const lignes = await db
              .select()
              .from(etatDesLieuxPieceSejour)
              .where(eq(etatDesLieuxPieceSejour.etatDesLieuxId, id));
            expect(lignes).toHaveLength(0);
          }
        },
        {
          nom: "submitPieceCuisine",
          soumettre: (id) => etatsDesLieuxService.submitPieceCuisine(id, { evier: { etatEntree: "B" } }),
          verifierAucuneEcriture: async (id) => {
            const lignes = await db
              .select()
              .from(etatDesLieuxPieceCuisine)
              .where(eq(etatDesLieuxPieceCuisine.etatDesLieuxId, id));
            expect(lignes).toHaveLength(0);
          }
        },
        {
          nom: "submitPieceChambre",
          soumettre: (id) => etatsDesLieuxService.submitPieceChambre(id, { numero: 1, mur: { etatEntree: "B" } }),
          verifierAucuneEcriture: async (id) => {
            const lignes = await db
              .select()
              .from(etatDesLieuxPiecesChambre)
              .where(eq(etatDesLieuxPiecesChambre.etatDesLieuxId, id));
            expect(lignes).toHaveLength(0);
          }
        },
        {
          nom: "submitPieceSalleDeBain",
          soumettre: (id) =>
            etatsDesLieuxService.submitPieceSalleDeBain(id, { numero: 1, lavabo: { etatEntree: "TB" } }),
          verifierAucuneEcriture: async (id) => {
            const lignes = await db
              .select()
              .from(etatDesLieuxPiecesSalleDeBain)
              .where(eq(etatDesLieuxPiecesSalleDeBain.etatDesLieuxId, id));
            expect(lignes).toHaveLength(0);
          }
        },
        {
          nom: "submitPieceWc",
          soumettre: (id) => etatsDesLieuxService.submitPieceWc(id, { numero: 1, wc: { etatEntree: "B" } }),
          verifierAucuneEcriture: async (id) => {
            const lignes = await db
              .select()
              .from(etatDesLieuxPiecesWc)
              .where(eq(etatDesLieuxPiecesWc.etatDesLieuxId, id));
            expect(lignes).toHaveLength(0);
          }
        },
        {
          nom: "submitPieceAutre",
          soumettre: (id) =>
            etatsDesLieuxService.submitPieceAutre(id, { numero: 1, libelle: "Buanderie", sol: { etatEntree: "B" } }),
          verifierAucuneEcriture: async (id) => {
            const lignes = await db
              .select()
              .from(etatDesLieuxPiecesAutre)
              .where(eq(etatDesLieuxPiecesAutre.etatDesLieuxId, id));
            expect(lignes).toHaveLength(0);
          }
        },
        {
          nom: "submitCompteurs",
          soumettre: (id) =>
            etatsDesLieuxService.submitCompteurs(id, { electricite: { numeroCompteurEntree: "ELEC123" } }),
          verifierAucuneEcriture: async (id) => {
            const lignes = await db
              .select()
              .from(etatDesLieuxCompteurs)
              .where(eq(etatDesLieuxCompteurs.etatDesLieuxId, id));
            expect(lignes).toHaveLength(0);
          }
        },
        {
          nom: "submitCles",
          soumettre: (id) =>
            etatsDesLieuxService.submitCles(id, { lignes: [{ typeCle: "immeuble", nombreEntree: 2 }] }),
          verifierAucuneEcriture: async (id) => {
            const lignes = await db.select().from(etatDesLieuxCles).where(eq(etatDesLieuxCles.etatDesLieuxId, id));
            expect(lignes).toHaveLength(0);
          }
        },
        {
          nom: "submitEquipementsDivers",
          soumettre: (id) =>
            etatsDesLieuxService.submitEquipementsDivers(id, {
              lignes: [{ libelle: "Store banne", etatEntree: "bon", nombreEntree: 1 }]
            }),
          verifierAucuneEcriture: async (id) => {
            const lignes = await db
              .select()
              .from(etatDesLieuxEquipementsDivers)
              .where(eq(etatDesLieuxEquipementsDivers.etatDesLieuxId, id));
            expect(lignes).toHaveLength(0);
          }
        },
        {
          nom: "submitInventaire",
          soumettre: async (id) => {
            const [element] = await db.select().from(elementsInventaireMeuble).limit(1);
            if (!element) {
              throw new Error("Catalogue inventaire meublé vide — le seed a-t-il tourné ?");
            }
            return etatsDesLieuxService.submitInventaire(id, {
              lignes: [{ elementId: element.id, nombreEntree: 1, etatEntree: "bon" }]
            });
          },
          verifierAucuneEcriture: async (id) => {
            const lignes = await db
              .select()
              .from(etatDesLieuxInventaire)
              .where(eq(etatDesLieuxInventaire.etatDesLieuxId, id));
            expect(lignes).toHaveLength(0);
          }
        }
      ];
    }

    for (const cas of casSections()) {
      describe(cas.nom, () => {
        it("réussit normalement quand l'état des lieux appartient à l'organisation appelante", async () => {
          await expect(contexteOrgA(() => cas.soumettre(orgA.etatDesLieuxId))).resolves.toBeDefined();
        });

        it("404 sur l'etatDesLieuxId d'une autre organisation, sans jamais écrire la section correspondante", async () => {
          await expect(contexteOrgB(() => cas.soumettre(orgA.etatDesLieuxId))).rejects.toThrow(NotFoundException);
          await cas.verifierAucuneEcriture(orgA.etatDesLieuxId);
        });

        it("404 sur un etatDesLieuxId inexistant", async () => {
          await expect(contexteOrgA(() => cas.soumettre(randomUUID()))).rejects.toThrow(NotFoundException);
        });

        it("hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
          await expect(
            requestContextService.executerAvecContexte({ utilisateurId: orgA.userId }, () =>
              cas.soumettre(orgA.etatDesLieuxId)
            )
          ).resolves.toBeDefined();
        });
      });
    }
  });
});
