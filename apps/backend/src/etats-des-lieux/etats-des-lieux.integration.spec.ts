import { randomUUID } from "crypto";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  elementsInventaireMeuble,
  etatDesLieuxCles,
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
import { CommonModule } from "../common/common.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { ImmeublesModule } from "../immeubles/immeubles.module";
import { ImmeublesService } from "../immeubles/immeubles.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { EtatsDesLieuxModule } from "./etats-des-lieux.module";
import { EtatsDesLieuxService } from "./etats-des-lieux.service";

// Vérifie le critère de complétion de l'étape 2 (backend État des lieux) :
// création, soumission indépendante par pièce (résilience réseau du
// parcours mobile), remplacement en bloc des listes courtes, et lecture
// assemblée complète. Chaque test tourne dans sa propre transaction
// annulée dans afterEach — voir test-utils/transactional-test.ts.
describe("État des lieux — soumission par pièce, listes en bloc, lecture assemblée (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let scisService: ScisService;
  let immeublesService: ImmeublesService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let etatsDesLieuxService: EtatsDesLieuxService;
  let db: Database;
  let bailId: string;

  beforeEach(async () => {
    db = await begin();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        CommonModule,
        DatabaseModule,
        UsersModule,
        AuthModule,
        ScisModule,
        ImmeublesModule,
        AppartementsModule,
        BauxModule,
        EtatsDesLieuxModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    immeublesService = moduleRef.get(ImmeublesService);
    appartementsService = moduleRef.get(AppartementsService);
    bauxService = moduleRef.get(BauxService);
    etatsDesLieuxService = moduleRef.get(EtatsDesLieuxService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation État des lieux Intégration" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }

    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `etats-des-lieux-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "ÉtatDesLieux",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }

    const sci = await scisService.create(user.id, {
      nom: "SCI État des lieux Test",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const immeuble = await immeublesService.create({
      sciId: sci.id,
      nom: "Immeuble État des lieux Test",
      adresse: "1 rue de l'État des lieux",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartement = await appartementsService.create({
      immeubleId: immeuble.id,
      numero: "1",
      type: "T3",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel",
      loyerReference: "900.00"
    });
    const bail = await bauxService.create({
      appartementId: appartement.id,
      typeBail: "meuble",
      dateDebut: "2026-08-01",
      jourEcheance: 5
    });
    bailId = bail.id;
  });

  afterEach(async () => {
    await moduleRef.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  it("create() : un seul état des lieux par bail, refuse un doublon", async () => {
    const entete = await etatsDesLieuxService.create({ bailId });
    expect(entete.bailId).toBe(bailId);
    expect(entete.dateEntree).toBeNull();
    expect(entete.statut).toBe("non_commence");

    await expect(etatsDesLieuxService.create({ bailId })).rejects.toThrow(/existe déjà/i);
  });

  it("statut dérivé (jamais stocké) : non_commence → entree_terminee → complet, selon date_entree/date_sortie", async () => {
    const entete = await etatsDesLieuxService.create({ bailId });
    expect(entete.statut).toBe("non_commence");

    const apresEntree = await etatsDesLieuxService.updateHeader(entete.id, { dateEntree: "2026-08-01" });
    expect(apresEntree.statut).toBe("entree_terminee");

    const apresSortie = await etatsDesLieuxService.updateHeader(entete.id, { dateSortie: "2027-07-31" });
    expect(apresSortie.statut).toBe("complet");

    const relu = await etatsDesLieuxService.findById(entete.id);
    expect(relu?.statut).toBe("complet");
  });

  it("submitPieceEntree() : upsert — un second appel met à jour la même ligne, n'en crée pas une seconde", async () => {
    const entete = await etatsDesLieuxService.create({ bailId });

    await etatsDesLieuxService.submitPieceEntree(entete.id, {
      porte: { description: "Porte blindée", etatEntree: "TB" },
      mur: { etatEntree: "B" },
      prises: { etatEntree: "B", nombre: 4 }
    });
    const releve = await etatsDesLieuxService.submitPieceEntree(entete.id, {
      mur: { etatEntree: "B", etatSortie: "P" }
    });

    expect(releve.porteDescription).toBe("Porte blindée");
    expect(releve.porteEtatEntree).toBe("TB");
    expect(releve.murEtatEntree).toBe("B");
    expect(releve.murEtatSortie).toBe("P");
    expect(releve.prisesNombre).toBe(4);

    const complet = await etatsDesLieuxService.findById(entete.id);
    expect(complet?.entree?.id).toBe(releve.id);
  });

  it("submitPieceChambre() : une ligne par numero, clé (etat_des_lieux_id, numero)", async () => {
    const entete = await etatsDesLieuxService.create({ bailId });

    const chambre1 = await etatsDesLieuxService.submitPieceChambre(entete.id, {
      numero: 1,
      mur: { etatEntree: "TB" }
    });
    const chambre2 = await etatsDesLieuxService.submitPieceChambre(entete.id, {
      numero: 2,
      mur: { etatEntree: "B" }
    });
    const chambre1MiseAJour = await etatsDesLieuxService.submitPieceChambre(entete.id, {
      numero: 1,
      mur: { etatEntree: "TB", etatSortie: "B" }
    });

    expect(chambre1MiseAJour.id).toBe(chambre1.id);
    expect(chambre1MiseAJour.murEtatSortie).toBe("B");

    const complet = await etatsDesLieuxService.findById(entete.id);
    expect(complet?.chambres).toHaveLength(2);
    expect(complet?.chambres.find((c) => c.numero === 2)?.id).toBe(chambre2.id);
  });

  it("submitPieceEntree() rejette un etatDesLieuxId inexistant", async () => {
    await expect(
      etatsDesLieuxService.submitPieceEntree(randomUUID(), { mur: { etatEntree: "B" } })
    ).rejects.toThrow(/introuvable/i);
  });

  it("submitCompteurs() : upsert 1:1, mappe les objets imbriqués électricité/gaz/eau vers les colonnes plates", async () => {
    const entete = await etatsDesLieuxService.create({ bailId });

    await etatsDesLieuxService.submitCompteurs(entete.id, {
      electricite: { numeroCompteurEntree: "ELEC123", releveHpEntree: "1000.50" },
      eau: { releveFroideEntree: "45.00" }
    });
    const compteurs = await etatsDesLieuxService.submitCompteurs(entete.id, {
      gaz: { numeroCompteurEntree: "GAZ456", releveEntree: "12.00" }
    });

    expect(compteurs.electriciteNumeroCompteurEntree).toBe("ELEC123");
    expect(compteurs.electriciteReleveHpEntree).toBe("1000.50");
    expect(compteurs.eauReleveFroideEntree).toBe("45.00");
    expect(compteurs.gazNumeroCompteurEntree).toBe("GAZ456");
    expect(compteurs.gazReleveEntree).toBe("12.00");
  });

  it("submitCles() : upsert par id — une soumission qui ne renvoie qu'une ligne modifiée ne touche jamais les autres", async () => {
    const entete = await etatsDesLieuxService.create({ bailId });

    const premiereSoumission = await etatsDesLieuxService.submitCles(entete.id, {
      lignes: [
        { typeCle: "immeuble", nombreEntree: 2 },
        { typeCle: "cave", nombreEntree: 1 }
      ]
    });
    const ligneImmeuble = premiereSoumission.find((l) => l.typeCle === "immeuble");
    if (!ligneImmeuble) {
      throw new Error("Ligne immeuble introuvable après la première soumission");
    }

    // Soumission "de sortie", des mois plus tard : seule la ligne immeuble
    // est renvoyée, avec son id — la ligne cave n'apparaît pas du tout
    // dans ce payload.
    await etatsDesLieuxService.submitCles(entete.id, {
      lignes: [{ id: ligneImmeuble.id, typeCle: "immeuble", nombreSortie: 2 }]
    });

    const complet = await etatsDesLieuxService.findById(entete.id);
    expect(complet?.cles).toHaveLength(2);
    const immeubleApresSortie = complet?.cles.find((l) => l.typeCle === "immeuble");
    expect(immeubleApresSortie?.nombreEntree).toBe(2);
    expect(immeubleApresSortie?.nombreSortie).toBe(2);
    const caveInchangee = complet?.cles.find((l) => l.typeCle === "cave");
    expect(caveInchangee?.nombreEntree).toBe(1);
    expect(caveInchangee?.nombreSortie).toBeNull();
  });

  it("submitCles() : rejette un id qui ne correspond à aucune ligne existante (jamais de correction de la mauvaise ligne)", async () => {
    const entete = await etatsDesLieuxService.create({ bailId });

    await expect(
      etatsDesLieuxService.submitCles(entete.id, {
        lignes: [{ id: randomUUID(), typeCle: "immeuble", nombreEntree: 1 }]
      })
    ).rejects.toThrow(/introuvable/i);
  });

  it("submitCles() : suppression uniquement via idsASupprimer — archivage, jamais un DELETE physique", async () => {
    const entete = await etatsDesLieuxService.create({ bailId });

    const soumission = await etatsDesLieuxService.submitCles(entete.id, {
      lignes: [
        { typeCle: "immeuble", nombreEntree: 2 },
        { typeCle: "cave", nombreEntree: 1 }
      ]
    });
    const ligneCave = soumission.find((l) => l.typeCle === "cave");
    if (!ligneCave) {
      throw new Error("Ligne cave introuvable après la première soumission");
    }

    const apresSuppression = await etatsDesLieuxService.submitCles(entete.id, {
      lignes: [],
      idsASupprimer: [ligneCave.id]
    });
    expect(apresSuppression).toHaveLength(1);
    expect(apresSuppression[0]?.typeCle).toBe("immeuble");

    // La ligne existe toujours en base, simplement archivée — jamais
    // détruite (CLAUDE.md, "jamais de DELETE sur une table métier").
    const [ligneCaveEnBase] = await db.select().from(etatDesLieuxCles).where(eq(etatDesLieuxCles.id, ligneCave.id));
    expect(ligneCaveEnBase).toBeDefined();
    expect(ligneCaveEnBase?.archivedAt).not.toBeNull();

    await expect(
      etatsDesLieuxService.submitCles(entete.id, { lignes: [], idsASupprimer: [randomUUID()] })
    ).rejects.toThrow(/introuvable/i);
  });

  it("submitEquipementsDivers() : upsert par id — une ligne non mentionnée n'est jamais touchée, suppression explicite seulement", async () => {
    const entete = await etatsDesLieuxService.create({ bailId });

    const premiereSoumission = await etatsDesLieuxService.submitEquipementsDivers(entete.id, {
      lignes: [{ libelle: "Store banne", etatEntree: "bon", nombreEntree: 1 }]
    });
    const ligneStore = premiereSoumission[0];
    if (!ligneStore) {
      throw new Error("Ligne store banne introuvable après la première soumission");
    }

    // Ajout d'une ligne à la sortie, sans renvoyer la ligne existante.
    const apresAjout = await etatsDesLieuxService.submitEquipementsDivers(entete.id, {
      lignes: [{ libelle: "Interphone", etatEntree: "dusage", nombreEntree: 1 }]
    });
    expect(apresAjout).toHaveLength(2);
    expect(apresAjout.find((l) => l.libelle === "Store banne")?.etatEntree).toBe("bon");

    const apresSuppression = await etatsDesLieuxService.submitEquipementsDivers(entete.id, {
      lignes: [],
      idsASupprimer: [ligneStore.id]
    });
    expect(apresSuppression).toHaveLength(1);
    expect(apresSuppression[0]?.libelle).toBe("Interphone");
  });

  it("submitInventaire() : upsert par elementId — un élément non mentionné n'est jamais touché, suppression explicite seulement", async () => {
    const entete = await etatsDesLieuxService.create({ bailId });
    const elementsCatalogue = await db.select().from(elementsInventaireMeuble).limit(2);
    expect(elementsCatalogue.length).toBe(2);
    const [premier, second] = elementsCatalogue;
    if (!premier || !second) {
      throw new Error("Catalogue inventaire meublé vide — le seed a-t-il tourné ?");
    }

    await etatsDesLieuxService.submitInventaire(entete.id, {
      lignes: [{ elementId: premier.id, nombreEntree: 4, etatEntree: "bon" }]
    });
    // Deuxième soumission : n'inclut pas `premier`, ajoute seulement `second`.
    const apresAjout = await etatsDesLieuxService.submitInventaire(entete.id, {
      lignes: [{ elementId: second.id, nombreEntree: 1, etatEntree: "dusage" }]
    });
    expect(apresAjout).toHaveLength(2);

    const complet = await etatsDesLieuxService.findById(entete.id);
    expect(complet?.inventaire).toHaveLength(2);
    expect(complet?.inventaire.find((i) => i.elementId === premier.id)?.nombreEntree).toBe(4);

    const apresSuppression = await etatsDesLieuxService.submitInventaire(entete.id, {
      lignes: [],
      elementsASupprimer: [premier.id]
    });
    expect(apresSuppression).toHaveLength(1);
    expect(apresSuppression[0]?.elementId).toBe(second.id);
  });

  it("updateHeader() : renseigne dateSortie / nouvelleAdresseLocataire (connus uniquement à la sortie)", async () => {
    const entete = await etatsDesLieuxService.create({ bailId });

    const misAJour = await etatsDesLieuxService.updateHeader(entete.id, {
      dateSortie: "2027-07-31",
      nouvelleAdresseLocataire: "12 rue du Départ, 75012 Paris"
    });

    expect(misAJour.dateSortie).toBe("2027-07-31");
    expect(misAJour.nouvelleAdresseLocataire).toBe("12 rue du Départ, 75012 Paris");
  });

  it("findByBailId() retrouve le même état des lieux que create(), findById() assemble toutes les sections", async () => {
    const entete = await etatsDesLieuxService.create({ bailId });
    await etatsDesLieuxService.submitPieceSejour(entete.id, { mur: { etatEntree: "B" } });
    await etatsDesLieuxService.submitPieceCuisine(entete.id, { evier: { etatEntree: "B" } });
    await etatsDesLieuxService.submitPieceSalleDeBain(entete.id, { numero: 1, lavabo: { etatEntree: "TB" } });
    await etatsDesLieuxService.submitPieceWc(entete.id, { numero: 1, wc: { etatEntree: "B" } });
    await etatsDesLieuxService.submitPieceAutre(entete.id, { numero: 1, libelle: "Buanderie", sol: { etatEntree: "B" } });

    const parBail = await etatsDesLieuxService.findByBailId(bailId);
    expect(parBail?.id).toBe(entete.id);

    const complet = await etatsDesLieuxService.findById(entete.id);
    expect(complet?.sejour?.murEtatEntree).toBe("B");
    expect(complet?.cuisine?.evierEtatEntree).toBe("B");
    expect(complet?.sallesDeBain).toHaveLength(1);
    expect(complet?.wc).toHaveLength(1);
    expect(complet?.autres).toHaveLength(1);
    expect(complet?.autres[0]?.libelle).toBe("Buanderie");
    expect(complet?.entree).toBeNull();
  });

  it("findById() sur un id inexistant renvoie null (pas d'exception)", async () => {
    const resultat = await etatsDesLieuxService.findById(randomUUID());
    expect(resultat).toBeNull();
  });
});
