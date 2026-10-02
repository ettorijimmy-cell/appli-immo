import { randomUUID } from "crypto";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, utilisateurs, type Database } from "db";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { ReglesCategorisationModule } from "../regles-categorisation/regles-categorisation.module";
import { ReglesCategorisationService } from "../regles-categorisation/regles-categorisation.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { DepensesModule } from "./depenses.module";
import { DepensesService } from "./depenses.service";

// Module Charges et fiscalité, Étape 1 (docs/backlog.md) : création +
// consultation d'une dépense, dérivation de sciId depuis bien.sciId,
// rattachement bienId/sciId. Tourne contre un vrai Postgres — voir
// scis.integration.spec.ts pour le fonctionnement général. Chaque test
// tourne dans sa propre transaction annulée dans afterEach (voir
// test-utils/transactional-test.ts), setup (organisation + utilisateur)
// compris.
describe("DepensesService (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let depensesService: DepensesService;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let reglesCategorisationService: ReglesCategorisationService;
  let db: Database;
  let userId: string;
  let organisationId: string;

  beforeEach(async () => {
    db = await begin();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        CommonModule,
        DatabaseModule,
        UsersModule,
        ScisModule,
        BienModule,
        AppartementsModule,
        ReglesCategorisationModule,
        DepensesModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    depensesService = moduleRef.get(DepensesService);
    scisService = moduleRef.get(ScisService);
    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    reglesCategorisationService = moduleRef.get(ReglesCategorisationService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Dépenses Intégration" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }

    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `depenses-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Dépenses",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    userId = user.id;
    organisationId = organisation.id;
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  it("crée une dépense rattachée à un bien et dérive sciId depuis bien.sciId", async () => {
    const sci = await scisService.create(userId, {
      nom: "SCI Dépenses Test",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Dépenses Test",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });

    const depense = await depensesService.create(userId, {
      categorie: "reparation_entretien",
      montant: "450.00",
      dateDepense: "2026-09-01",
      libelle: "Plomberie appartement 3",
      bienId: bien.id
    });

    expect(depense.bienId).toBe(bien.id);
    expect(depense.sciId).toBe(sci.id);
    expect(depense.organisationId).toBe(organisationId);
    expect(depense.categorie).toBe("reparation_entretien");
    expect(depense.montant).toBe("450.00");
  });

  it("crée une dépense rattachée directement à une SCI, sans bien précis", async () => {
    const sci = await scisService.create(userId, {
      nom: "SCI Dépenses Frais Gestion",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });

    const depense = await depensesService.create(userId, {
      categorie: "frais_gestion",
      montant: "120.00",
      dateDepense: "2026-09-02",
      libelle: "Honoraires comptable",
      sciId: sci.id
    });

    expect(depense.bienId).toBeNull();
    expect(depense.sciId).toBe(sci.id);
  });

  it("rejette une dépense sans bienId ni sciId", async () => {
    await expect(
      depensesService.create(userId, {
        categorie: "autre",
        montant: "50.00",
        dateDepense: "2026-09-02",
        libelle: "Dépense orpheline"
      })
    ).rejects.toThrow(/bienId, sciId ou appartementId est requis/);
  });

  it("ignore le sciId transmis par le client quand bienId est fourni (dérive toujours depuis bien.sciId)", async () => {
    const sci = await scisService.create(userId, {
      nom: "SCI Dépenses Cohérence",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const autreSci = await scisService.create(userId, {
      nom: "Autre SCI",
      regimeFiscal: "IR",
      adresse: "2 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Dépenses Cohérence",
      adresse: "3 rue de Test",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });

    const depense = await depensesService.create(userId, {
      categorie: "assurance",
      montant: "80.00",
      dateDepense: "2026-09-03",
      libelle: "Assurance PNO",
      bienId: bien.id,
      sciId: autreSci.id
    });

    expect(depense.sciId).toBe(sci.id);
  });

  it("findAll filtre par catégorie, bienId et période", async () => {
    const sci = await scisService.create(userId, {
      nom: "SCI Dépenses FindAll",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Dépenses FindAll",
      adresse: "4 rue de Test",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });

    await depensesService.create(userId, {
      categorie: "reparation_entretien",
      montant: "200.00",
      dateDepense: "2026-06-15",
      libelle: "Réparation juin",
      bienId: bien.id
    });
    await depensesService.create(userId, {
      categorie: "assurance",
      montant: "80.00",
      dateDepense: "2026-09-05",
      libelle: "Assurance septembre",
      bienId: bien.id
    });

    const toutes = await depensesService.findAll({});
    expect(toutes.length).toBeGreaterThanOrEqual(2);

    const parCategorie = await depensesService.findAll({ categorie: "assurance" });
    expect(parCategorie.map((d) => d.libelle)).toContain("Assurance septembre");
    expect(parCategorie.map((d) => d.libelle)).not.toContain("Réparation juin");

    const parPeriode = await depensesService.findAll({ dateDebut: "2026-09-01", dateFin: "2026-09-30" });
    expect(parPeriode.map((d) => d.libelle)).toContain("Assurance septembre");
    expect(parPeriode.map((d) => d.libelle)).not.toContain("Réparation juin");

    const parBien = await depensesService.findAll({ bienId: bien.id });
    expect(parBien).toHaveLength(2);
  });

  // Module Charges et fiscalité, Étape 2 (docs/backlog.md) : présélection
  // de catégorie sur les lignes candidates d'un import CSV.
  describe("parserCsv — suggestion de catégorie", () => {
    it("suggère la catégorie quand exactement une règle de l'organisation correspond au libellé", async () => {
      await reglesCategorisationService.create(userId, { motCle: "edf", categorie: "charges_copropriete" });

      const csv = "Date,Debit,Credit,Libelle\n2026-09-01,120.00,,PRLV EDF ENERGIE\n";
      const [ligne] = await depensesService.parserCsv(userId, csv);

      expect(ligne?.categorieSuggeree).toBe("charges_copropriete");
    });

    it("ne suggère rien quand aucune règle ne correspond", async () => {
      await reglesCategorisationService.create(userId, { motCle: "edf", categorie: "charges_copropriete" });

      const csv = "Date,Debit,Credit,Libelle\n2026-09-01,120.00,,VIR DUPONT LOYER\n";
      const [ligne] = await depensesService.parserCsv(userId, csv);

      expect(ligne?.categorieSuggeree).toBeNull();
    });

    it("ne suggère rien quand plusieurs règles correspondent au même libellé — jamais de choix arbitraire", async () => {
      await reglesCategorisationService.create(userId, { motCle: "assurance", categorie: "assurance" });
      await reglesCategorisationService.create(userId, { motCle: "habitation", categorie: "reparation_entretien" });

      const csv = "Date,Debit,Credit,Libelle\n2026-09-01,120.00,,PRLV ASSURANCE HABITATION MAIF\n";
      const [ligne] = await depensesService.parserCsv(userId, csv);

      expect(ligne?.categorieSuggeree).toBeNull();
    });

    it("ignore les règles archivées et celles d'une autre organisation", async () => {
      const regleArchivee = await reglesCategorisationService.create(userId, {
        motCle: "edf",
        categorie: "charges_copropriete"
      });
      await reglesCategorisationService.archive(regleArchivee.id);

      const csv = "Date,Debit,Credit,Libelle\n2026-09-01,120.00,,PRLV EDF ENERGIE\n";
      const [ligne] = await depensesService.parserCsv(userId, csv);

      expect(ligne?.categorieSuggeree).toBeNull();
    });
  });

  // Module Régularisation des charges, Sous-commit A (2026-09-30) :
  // rattachement optionnel d'une dépense à un appartement précis, sous
  // bienId — une dépense imputable à un logement (par opposition à une
  // charge commune d'immeuble à répartir manuellement).
  describe("rattachement appartementId", () => {
    async function creerBienEtAppartement(suffixe: string) {
      const sci = await scisService.create(userId, {
        nom: `SCI Dépenses Appartement ${suffixe}`,
        regimeFiscal: "IR",
        adresse: "1 rue de Test",
        codePostal: "75001",
        ville: "Paris"
      });
      const bienCree = await bienService.create(userId, {
        type: "immeuble",
        proprietaireType: "sci",
        sciId: sci.id,
        nom: `Immeuble Dépenses Appartement ${suffixe}`,
        adresse: "5 rue de Test",
        codePostal: "75001",
        ville: "Paris",
        typeHabitat: "collectif",
        regimeJuridique: "copropriete"
      });
      const appartement = await appartementsService.create({
        bienId: bienCree.id,
        numero: `L-${suffixe}`,
        type: "T2",
        surface: "45.50",
        nombrePiecesPrincipales: 2,
        modeChauffage: "individuel",
        modeEauChaude: "individuel"
      });
      return { sci, bien: bienCree, appartement };
    }

    it("dérive bienId (et sciId) depuis l'appartement quand seul appartementId est transmis", async () => {
      const { sci, bien, appartement } = await creerBienEtAppartement("A");

      const depense = await depensesService.create(userId, {
        categorie: "reparation_entretien",
        montant: "90.00",
        dateDepense: "2026-09-10",
        libelle: "Remplacement robinetterie",
        appartementId: appartement.id
      });

      expect(depense.appartementId).toBe(appartement.id);
      expect(depense.bienId).toBe(bien.id);
      expect(depense.sciId).toBe(sci.id);
    });

    it("accepte appartementId + bienId cohérents entre eux", async () => {
      const { bien, appartement } = await creerBienEtAppartement("B");

      const depense = await depensesService.create(userId, {
        categorie: "assurance",
        montant: "30.00",
        dateDepense: "2026-09-11",
        libelle: "Assurance dégât des eaux",
        bienId: bien.id,
        appartementId: appartement.id
      });

      expect(depense.bienId).toBe(bien.id);
      expect(depense.appartementId).toBe(appartement.id);
    });

    it("rejette un appartementId qui n'appartient pas au bienId transmis — incohérence jamais silencieuse", async () => {
      const { appartement } = await creerBienEtAppartement("C");
      const { bien: autreBien } = await creerBienEtAppartement("D");

      await expect(
        depensesService.create(userId, {
          categorie: "reparation_entretien",
          montant: "60.00",
          dateDepense: "2026-09-12",
          libelle: "Dépense incohérente",
          bienId: autreBien.id,
          appartementId: appartement.id
        })
      ).rejects.toThrow(/n'appartient pas au bien/);
    });

    it("rejette un appartementId inexistant", async () => {
      await expect(
        depensesService.create(userId, {
          categorie: "autre",
          montant: "10.00",
          dateDepense: "2026-09-13",
          libelle: "Appartement fantôme",
          appartementId: randomUUID()
        })
      ).rejects.toThrow(/Appartement introuvable/);
    });

    it("findAll filtre par appartementId", async () => {
      const { bien, appartement } = await creerBienEtAppartement("E");
      await depensesService.create(userId, {
        categorie: "reparation_entretien",
        montant: "70.00",
        dateDepense: "2026-09-14",
        libelle: "Dépense du logement",
        appartementId: appartement.id
      });
      await depensesService.create(userId, {
        categorie: "frais_gestion",
        montant: "25.00",
        dateDepense: "2026-09-14",
        libelle: "Dépense de l'immeuble entier",
        bienId: bien.id
      });

      const parAppartement = await depensesService.findAll({ appartementId: appartement.id });
      expect(parAppartement.map((d) => d.libelle)).toEqual(["Dépense du logement"]);

      const parBien = await depensesService.findAll({ bienId: bien.id });
      expect(parBien).toHaveLength(2);
    });
  });

  // Module Régularisation des charges, Sous-commit D (2026-10-02) :
  // répartition d'une charge commune d'immeuble entre tous les lots
  // éligibles, par tantième si tous en ont un, sinon par surface pour
  // tous — jamais de mélange des deux unités.
  describe("repartirDepenseEntreLots", () => {
    async function creerImmeubleAvecLots(
      suffixe: string,
      lots: Array<{ numero: string; tantieme?: string; surface?: string }>
    ) {
      const sci = await scisService.create(userId, {
        nom: `SCI Répartition ${suffixe}`,
        regimeFiscal: "IR",
        adresse: "1 rue de Test",
        codePostal: "75001",
        ville: "Paris"
      });
      const bienCree = await bienService.create(userId, {
        type: "immeuble",
        proprietaireType: "sci",
        sciId: sci.id,
        nom: `Immeuble Répartition ${suffixe}`,
        adresse: "1 rue de Test",
        codePostal: "75001",
        ville: "Paris",
        typeHabitat: "collectif",
        regimeJuridique: "copropriete"
      });
      const appartementsCrees = [];
      for (const lot of lots) {
        const appartement = await appartementsService.create({
          bienId: bienCree.id,
          numero: lot.numero,
          type: "T2",
          nombrePiecesPrincipales: 2,
          modeChauffage: "individuel",
          modeEauChaude: "individuel",
          ...(lot.tantieme !== undefined && { tantieme: lot.tantieme }),
          ...(lot.surface !== undefined && { surface: lot.surface })
        });
        appartementsCrees.push(appartement);
      }
      return { sci, bien: bienCree, appartements: appartementsCrees };
    }

    it("répartit par tantième quand tous les lots éligibles en ont un renseigné", async () => {
      const { bien, appartements } = await creerImmeubleAvecLots("Tantieme", [
        { numero: "A", tantieme: "600.00" },
        { numero: "B", tantieme: "400.00" }
      ]);
      const depenseSource = await depensesService.create(userId, {
        categorie: "charges_copropriete",
        montant: "1000.00",
        dateDepense: "2026-06-01",
        libelle: "Ravalement façade",
        bienId: bien.id
      });

      const resultat = await depensesService.repartirDepenseEntreLots(depenseSource.id, userId);

      expect(resultat.cle).toBe("tantieme");
      expect(resultat.source.montant).toBe("0.00");
      expect(resultat.source.libelle).toContain("montant original : 1000.00 €");
      const parLot = new Map(resultat.enfants.map((e) => [e.appartementId, e.montant]));
      expect(parLot.get(appartements[0]!.id)).toBe("600.00");
      expect(parLot.get(appartements[1]!.id)).toBe("400.00");
      expect(resultat.enfants.every((e) => e.depenseSourceId === depenseSource.id)).toBe(true);
      expect(resultat.enfants.every((e) => e.categorie === "charges_copropriete")).toBe(true);
      expect(resultat.enfants.every((e) => e.dateDepense === "2026-06-01")).toBe(true);
    });

    it("bascule sur la surface pour TOUS les lots dès qu'un seul lot éligible n'a pas de tantième — jamais de mélange", async () => {
      const { bien, appartements } = await creerImmeubleAvecLots("Surface", [
        { numero: "A", tantieme: "600.00", surface: "60.00" },
        { numero: "B", surface: "40.00" }
      ]);
      const depenseSource = await depensesService.create(userId, {
        categorie: "charges_copropriete",
        montant: "1000.00",
        dateDepense: "2026-06-02",
        libelle: "Entretien ascenseur",
        bienId: bien.id
      });

      const resultat = await depensesService.repartirDepenseEntreLots(depenseSource.id, userId);

      expect(resultat.cle).toBe("surface");
      const parLot = new Map(resultat.enfants.map((e) => [e.appartementId, e.montant]));
      // Proportionnel à 60/40, PAS à 600/400 (tantième du lot A ignoré).
      expect(parLot.get(appartements[0]!.id)).toBe("600.00");
      expect(parLot.get(appartements[1]!.id)).toBe("400.00");
    });

    it("rejette la répartition si un lot éligible n'a ni tantième ni surface, en le nommant dans le message", async () => {
      const { bien } = await creerImmeubleAvecLots("Incomplet", [
        { numero: "A", tantieme: "600.00", surface: "60.00" },
        { numero: "B" }
      ]);
      const depenseSource = await depensesService.create(userId, {
        categorie: "charges_copropriete",
        montant: "1000.00",
        dateDepense: "2026-06-03",
        libelle: "Charge sans clé possible",
        bienId: bien.id
      });

      await expect(depensesService.repartirDepenseEntreLots(depenseSource.id, userId)).rejects.toThrow(
        /lot\(s\) sans surface renseignée : B/
      );
    });

    // Revue financial-logic-reviewer, 2026-10-02 : cas composite où AUCUN
    // lot ne manque les deux valeurs à la fois (chacun a l'une des deux),
    // mais la bascule surface échoue tout de même puisque B n'a pas de
    // surface — le message doit nommer B, jamais rester vide (régression :
    // l'ancien filtre "ni l'un ni l'autre" ne trouvait aucun lot ici).
    it("nomme correctement le lot en cause quand aucun lot ne manque les deux valeurs à la fois", async () => {
      const { bien } = await creerImmeubleAvecLots("Composite", [
        { numero: "A", tantieme: "600.00" },
        { numero: "B", surface: "40.00" }
      ]);
      const depenseSource = await depensesService.create(userId, {
        categorie: "charges_copropriete",
        montant: "1000.00",
        dateDepense: "2026-06-03",
        libelle: "Charge avec clés disjointes entre lots",
        bienId: bien.id
      });

      await expect(depensesService.repartirDepenseEntreLots(depenseSource.id, userId)).rejects.toThrow(
        /lot\(s\) sans surface renseignée : A/
      );
    });

    it("inclut les lots vacants (aucun bail actif) dans la base de répartition", async () => {
      const { bien, appartements } = await creerImmeubleAvecLots("Vacant", [
        { numero: "A", tantieme: "500.00" },
        { numero: "B", tantieme: "500.00" }
      ]);
      expect(appartements.every((a) => a.statut === "vacant")).toBe(true);
      const depenseSource = await depensesService.create(userId, {
        categorie: "charges_copropriete",
        montant: "200.00",
        dateDepense: "2026-06-04",
        libelle: "Charge immeuble entièrement vacant",
        bienId: bien.id
      });

      const resultat = await depensesService.repartirDepenseEntreLots(depenseSource.id, userId);

      expect(resultat.enfants).toHaveLength(2);
      expect(resultat.enfants.map((e) => e.montant).sort()).toEqual(["100.00", "100.00"]);
    });

    it("exclut les lots archivés de la base de répartition", async () => {
      const { bien, appartements } = await creerImmeubleAvecLots("Archive", [
        { numero: "A", tantieme: "500.00" },
        { numero: "B", tantieme: "500.00" },
        { numero: "C", tantieme: "500.00" }
      ]);
      await appartementsService.archive(appartements[2]!.id);

      const depenseSource = await depensesService.create(userId, {
        categorie: "charges_copropriete",
        montant: "900.00",
        dateDepense: "2026-06-05",
        libelle: "Charge avec un lot archivé",
        bienId: bien.id
      });

      const resultat = await depensesService.repartirDepenseEntreLots(depenseSource.id, userId);

      expect(resultat.enfants).toHaveLength(2);
      const idsRepartis = resultat.enfants.map((e) => e.appartementId);
      expect(idsRepartis).not.toContain(appartements[2]!.id);
      expect(resultat.enfants.map((e) => e.montant).sort()).toEqual(["450.00", "450.00"]);
    });

    it("rejette une seconde répartition de la même dépense source — jamais de double répartition silencieuse", async () => {
      const { bien } = await creerImmeubleAvecLots("DoubleSource", [
        { numero: "A", tantieme: "500.00" },
        { numero: "B", tantieme: "500.00" }
      ]);
      const depenseSource = await depensesService.create(userId, {
        categorie: "charges_copropriete",
        montant: "300.00",
        dateDepense: "2026-06-06",
        libelle: "Charge à ne répartir qu'une fois",
        bienId: bien.id
      });

      await depensesService.repartirDepenseEntreLots(depenseSource.id, userId);

      await expect(depensesService.repartirDepenseEntreLots(depenseSource.id, userId)).rejects.toThrow(
        /déjà été répartie/
      );
    });

    it("rejette la répartition d'une dépense qui est elle-même une dépense enfant", async () => {
      const { bien } = await creerImmeubleAvecLots("DoubleEnfant", [
        { numero: "A", tantieme: "500.00" },
        { numero: "B", tantieme: "500.00" }
      ]);
      const depenseSource = await depensesService.create(userId, {
        categorie: "charges_copropriete",
        montant: "300.00",
        dateDepense: "2026-06-07",
        libelle: "Charge mère",
        bienId: bien.id
      });
      const resultat = await depensesService.repartirDepenseEntreLots(depenseSource.id, userId);
      const enfant = resultat.enfants[0]!;

      await expect(depensesService.repartirDepenseEntreLots(enfant.id, userId)).rejects.toThrow();
    });

    it("rejette une dépense sans bienId (niveau SCI seul)", async () => {
      const sci = await scisService.create(userId, {
        nom: "SCI Répartition Sans Bien",
        regimeFiscal: "IR",
        adresse: "1 rue de Test",
        codePostal: "75001",
        ville: "Paris"
      });
      const depenseSource = await depensesService.create(userId, {
        categorie: "frais_gestion",
        montant: "100.00",
        dateDepense: "2026-06-08",
        libelle: "Honoraires comptable SCI",
        sciId: sci.id
      });

      await expect(depensesService.repartirDepenseEntreLots(depenseSource.id, userId)).rejects.toThrow(
        /rattachée à un bien/
      );
    });

    it("previsualiserRepartition calcule exactement les mêmes parts que l'exécution réelle, sans rien écrire", async () => {
      const { bien, appartements } = await creerImmeubleAvecLots("Apercu", [
        { numero: "A", tantieme: "700.00" },
        { numero: "B", tantieme: "300.00" }
      ]);
      const depenseSource = await depensesService.create(userId, {
        categorie: "charges_copropriete",
        montant: "1000.00",
        dateDepense: "2026-06-09",
        libelle: "Charge avec aperçu",
        bienId: bien.id
      });

      const apercu = await depensesService.previsualiserRepartition(depenseSource.id, userId);
      expect(apercu.cle).toBe("tantieme");
      const apercuParLot = new Map(apercu.parts.map((p) => [p.appartementId, p.montant]));
      expect(apercuParLot.get(appartements[0]!.id)).toBe("700.00");
      expect(apercuParLot.get(appartements[1]!.id)).toBe("300.00");

      // L'aperçu n'a rien écrit : la dépense source est toujours intacte,
      // aucun enfant n'existe encore.
      const [sourceInchangee] = await depensesService.findAll({ bienId: bien.id });
      expect(sourceInchangee?.montant).toBe("1000.00");

      const resultat = await depensesService.repartirDepenseEntreLots(depenseSource.id, userId);
      const resultatParLot = new Map(resultat.enfants.map((e) => [e.appartementId, e.montant]));
      expect(resultatParLot).toEqual(apercuParLot);
    });
  });
});
