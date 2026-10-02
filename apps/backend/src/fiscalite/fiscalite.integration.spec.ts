import { randomUUID } from "crypto";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, utilisateurs, type Database } from "db";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuditModule } from "../audit/audit.module";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { DepensesModule } from "../depenses/depenses.module";
import { DepensesService } from "../depenses/depenses.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { FiscaliteModule } from "./fiscalite.module";
import { FiscaliteService } from "./fiscalite.service";

// Module Charges et fiscalité, Étape 4 (2072-S-A1-SD, cadre VII). Tourne
// contre un vrai Postgres (voir scis.integration.spec.ts pour le
// fonctionnement général) ; chaque test dans sa propre transaction annulée
// (test-utils/transactional-test.ts).
describe("FiscaliteService (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let fiscaliteService: FiscaliteService;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let depensesService: DepensesService;
  let db: Database;
  let userId: string;

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
        ScisModule,
        BienModule,
        AppartementsModule,
        DepensesModule,
        FiscaliteModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    fiscaliteService = moduleRef.get(FiscaliteService);
    scisService = moduleRef.get(ScisService);
    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    depensesService = moduleRef.get(DepensesService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Fiscalité Intégration" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }

    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `fiscalite-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Fiscalité",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    userId = user.id;
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  async function creerBienAvecLots(sciId: string, nom: string, nombreLots: number) {
    const bienCree = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId,
      nom,
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    for (let i = 0; i < nombreLots; i += 1) {
      await appartementsService.create({
        bienId: bienCree.id,
        numero: `L${i + 1}`,
        type: "T2",
        nombrePiecesPrincipales: 2,
        modeChauffage: "individuel",
        modeEauChaude: "individuel"
      });
    }
    return bienCree;
  }

  it("rejette une SCI à l'IS — hors périmètre de l'Annexe 1", async () => {
    const sciIs = await scisService.create(userId, {
      nom: "SCI IS Test",
      regimeFiscal: "IS",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });

    await expect(fiscaliteService.calculerAnnexe1PourSci(userId, sciIs.id, 2026)).rejects.toThrow(/IR/);
  });

  it("calcule la ligne 7 (forfait 20€/lot) et un résultat déficitaire sans aucune dépense ni revenu", async () => {
    const sci = await scisService.create(userId, {
      nom: "SCI Forfait Test",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    await creerBienAvecLots(sci.id, "Immeuble Forfait", 3);

    const resultat = await fiscaliteService.calculerAnnexe1PourSci(userId, sci.id, 2026);

    expect(resultat.biens).toHaveLength(1);
    const [ligneBien] = resultat.biens;
    expect(ligneBien!.nombreLots).toBe(3);
    expect(ligneBien!.lignes.ligne7).toBe("60.00");
    expect(ligneBien!.lignes.ligne1).toBe("0.00");
    expect(ligneBien!.lignes.ligne16).toBe("60.00");
    expect(ligneBien!.lignes.ligne18).toBe("-60.00");
    expect(ligneBien!.lignes.ligne23).toBe("-60.00");
    expect(resultat.totalSci).toBe("-60.00");
  });

  it("agrège les dépenses par catégorie sur les lignes automatiques correspondantes", async () => {
    const sci = await scisService.create(userId, {
      nom: "SCI Catégories Test",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bienCree = await creerBienAvecLots(sci.id, "Immeuble Catégories", 1);

    await depensesService.create(userId, {
      categorie: "frais_gestion",
      montant: "100.00",
      dateDepense: "2026-03-01",
      libelle: "Frais gestion",
      bienId: bienCree.id
    });
    await depensesService.create(userId, {
      categorie: "assurance",
      montant: "200.00",
      dateDepense: "2026-04-01",
      libelle: "Assurance PNO",
      bienId: bienCree.id
    });
    await depensesService.create(userId, {
      categorie: "interets_emprunt",
      montant: "300.00",
      dateDepense: "2026-05-01",
      libelle: "Intérêts emprunt",
      bienId: bienCree.id
    });
    // Hors année civile 2026 — ne doit pas être compté.
    await depensesService.create(userId, {
      categorie: "assurance",
      montant: "999.00",
      dateDepense: "2025-12-31",
      libelle: "Assurance année précédente",
      bienId: bienCree.id
    });

    const resultat = await fiscaliteService.calculerAnnexe1PourSci(userId, sci.id, 2026);
    const [ligneBien] = resultat.biens;

    expect(ligneBien!.lignes.ligne6).toBe("100.00");
    expect(ligneBien!.lignes.ligne8).toBe("200.00");
    expect(ligneBien!.lignes.ligne17).toBe("300.00");
    expect(ligneBien!.lignes.ligne9).toBe("0.00");
  });

  // Module Régularisation des charges, Sous-commit A (2026-09-30) :
  // une dépense rattachée à un appartement précis (granularité plus fine
  // que bienId seul) doit continuer à être comptée exactement comme avant
  // dans l'Annexe 1 — une dépense reste une dépense du bien quel que soit
  // son niveau de granularité, aucun changement de comportement attendu
  // côté FiscaliteService.
  it("compte toujours une dépense rattachée à un appartement précis dans l'Annexe 1 du bien", async () => {
    const sci = await scisService.create(userId, {
      nom: "SCI Appartement Précis Test",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bienCree = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Appartement Précis",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartement = await appartementsService.create({
      bienId: bienCree.id,
      numero: "3B",
      type: "T2",
      nombrePiecesPrincipales: 2,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });

    await depensesService.create(userId, {
      categorie: "reparation_entretien",
      montant: "75.00",
      dateDepense: "2026-06-01",
      libelle: "Robinetterie appartement 3B",
      appartementId: appartement.id
    });

    const resultat = await fiscaliteService.calculerAnnexe1PourSci(userId, sci.id, 2026);
    const [ligneBien] = resultat.biens;

    expect(ligneBien!.lignes.ligne9).toBe("75.00");
  });

  // Module Régularisation des charges, Sous-commit D (2026-10-02) :
  // vérifie que DepensesService.repartirDepenseEntreLots ne change jamais
  // le total fiscal d'un bien — la dépense source passe à 0.00 (son
  // libellé conserve le montant d'origine) pendant que les N dépenses
  // enfants créées portent exactement ce même total réparti entre les
  // lots. Avant/après doivent donc être rigoureusement identiques.
  it("ne change pas le total de l'Annexe 1 après répartition d'une charge commune entre les lots", async () => {
    const sci = await scisService.create(userId, {
      nom: "SCI Répartition Fiscalité Test",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bienCree = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Répartition Fiscalité",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    await appartementsService.create({
      bienId: bienCree.id,
      numero: "A",
      type: "T2",
      tantieme: "600.00",
      nombrePiecesPrincipales: 2,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    await appartementsService.create({
      bienId: bienCree.id,
      numero: "B",
      type: "T2",
      tantieme: "400.00",
      nombrePiecesPrincipales: 2,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    const depenseSource = await depensesService.create(userId, {
      categorie: "charges_copropriete",
      montant: "1000.00",
      dateDepense: "2026-06-01",
      libelle: "Ravalement façade",
      bienId: bienCree.id
    });

    const avant = await fiscaliteService.calculerAnnexe1PourSci(userId, sci.id, 2026);
    const [ligneBienAvant] = avant.biens;
    expect(ligneBienAvant!.lignes.ligne13).toBe("1000.00");

    await depensesService.repartirDepenseEntreLots(depenseSource.id, userId);

    const apres = await fiscaliteService.calculerAnnexe1PourSci(userId, sci.id, 2026);
    const [ligneBienApres] = apres.biens;
    expect(ligneBienApres!.lignes.ligne13).toBe("1000.00");
    expect(apres.totalSci).toBe(avant.totalSci);
  });

  // Revue financial-logic-reviewer, 2026-09-12 : un bien archivé APRÈS
  // avoir généré une dépense sur l'année ne doit pas disparaître de
  // l'Annexe 1 de cette année-là — même principe que getSynthese
  // (tableau-de-bord.service.ts), le fait historique reste, l'archivage
  // ultérieur ne l'efface pas.
  it("inclut un bien archivé en cours d'année — ses lignes propres restent, mais il ne reçoit aucune part du prorata SCI", async () => {
    const sci = await scisService.create(userId, {
      nom: "SCI Bien Archivé Test",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bienVendu = await creerBienAvecLots(sci.id, "Immeuble Vendu En Cours D'Année", 1);
    const bienRestant = await creerBienAvecLots(sci.id, "Immeuble Restant", 1);

    await depensesService.create(userId, {
      categorie: "reparation_entretien",
      montant: "150.00",
      dateDepense: "2026-03-01",
      libelle: "Réparation avant vente",
      bienId: bienVendu.id
    });
    // Dépense de niveau SCI, après la vente — ne doit être répartie
    // qu'entre les biens encore actifs (ici : bienRestant seul).
    await depensesService.create(userId, {
      categorie: "frais_gestion",
      montant: "80.00",
      dateDepense: "2026-08-01",
      libelle: "Honoraires comptable SCI",
      sciId: sci.id
    });

    await bienService.archive(bienVendu.id);

    const resultat = await fiscaliteService.calculerAnnexe1PourSci(userId, sci.id, 2026);

    expect(resultat.biens).toHaveLength(2);
    const ligneVendu = resultat.biens.find((b) => b.bienId === bienVendu.id);
    const ligneRestant = resultat.biens.find((b) => b.bienId === bienRestant.id);

    // Le bien archivé garde sa propre dépense (fait historique).
    expect(ligneVendu!.lignes.ligne9).toBe("150.00");
    // ...mais ne reçoit aucune part du prorata de niveau SCI (diviseur = 1
    // seul bien actif restant, pas 2).
    expect(ligneVendu!.proratasAppliques).toEqual([]);
    expect(ligneRestant!.lignes.ligne6).toBe("80.00");
    expect(ligneRestant!.proratasAppliques).toEqual([{ ligne: "ligne6", montant: "80.00" }]);
  });

  it("répartit une dépense de niveau SCI à parts égales entre tous les biens actifs", async () => {
    const sci = await scisService.create(userId, {
      nom: "SCI Prorata Test",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bienA = await creerBienAvecLots(sci.id, "Immeuble Prorata A", 1);
    const bienB = await creerBienAvecLots(sci.id, "Immeuble Prorata B", 1);
    const bienC = await creerBienAvecLots(sci.id, "Immeuble Prorata C", 1);

    // 100.00 € répartis entre 3 biens = 33.34/33.33/33.33 (reste distribué
    // au premier bien, voir repartirCentimesEgalement).
    await depensesService.create(userId, {
      categorie: "frais_gestion",
      montant: "100.00",
      dateDepense: "2026-06-01",
      libelle: "Honoraires comptable SCI",
      sciId: sci.id
    });

    const resultat = await fiscaliteService.calculerAnnexe1PourSci(userId, sci.id, 2026);
    const montantsLigne6 = resultat.biens.map((b) => b.lignes.ligne6).sort();

    expect(montantsLigne6).toEqual(["33.33", "33.33", "33.34"]);
    // La somme exacte des parts reconstitue le montant d'origine, aucune
    // perte d'arrondi.
    const totalCentimes = resultat.biens.reduce((total, b) => total + Math.round(Number(b.lignes.ligne6) * 100), 0);
    expect(totalCentimes).toBe(10000);

    for (const b of resultat.biens) {
      expect(b.proratasAppliques).toEqual([{ ligne: "ligne6", montant: b.lignes.ligne6 }]);
    }

    // Vérifie que les 3 biens créés sont bien tous représentés (ordre non
    // garanti, seule la présence compte).
    const bienIds = resultat.biens.map((b) => b.bienId).sort();
    expect(bienIds).toEqual([bienA.id, bienB.id, bienC.id].sort());
  });

  it("sauvegarderSaisieManuelle crée puis met à jour (upsert) et alimente les totaux calculés", async () => {
    const sci = await scisService.create(userId, {
      nom: "SCI Saisie Manuelle Test",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bienCree = await creerBienAvecLots(sci.id, "Immeuble Saisie Manuelle", 0);

    const creation = await fiscaliteService.sauvegarderSaisieManuelle(userId, bienCree.id, 2026, {
      ligne2: "500.00"
    });
    expect(creation.ligne2).toBe("500.00");

    let resultat = await fiscaliteService.calculerAnnexe1PourSci(userId, sci.id, 2026);
    expect(resultat.biens[0]!.lignes.ligne5).toBe("500.00");
    expect(resultat.biens[0]!.lignes.ligne18).toBe("500.00");

    // Deuxième appel sur le même (bienId, année) : mise à jour, pas une
    // deuxième ligne (contrainte unique bien_id/annee).
    const miseAJour = await fiscaliteService.sauvegarderSaisieManuelle(userId, bienCree.id, 2026, {
      ligne2: "700.00",
      ligne3: "100.00"
    });
    expect(miseAJour.ligne2).toBe("700.00");
    expect(miseAJour.ligne3).toBe("100.00");

    resultat = await fiscaliteService.calculerAnnexe1PourSci(userId, sci.id, 2026);
    expect(resultat.biens[0]!.lignes.ligne5).toBe("800.00");

    // Effacement explicite (chaîne vide) : remet la colonne à NULL, traitée
    // comme 0.
    const efface = await fiscaliteService.sauvegarderSaisieManuelle(userId, bienCree.id, 2026, { ligne2: "" });
    expect(efface.ligne2).toBeNull();
    expect(efface.ligne3).toBe("100.00");
  });

  // Extension fiscale 2044 (biens en nom propre), décisions actées avec
  // Jimmy le 2026-09-30 : périmètre resserré à 4 lignes automatiques
  // (221/223/224/227), voir packages/core/src/fiscalite/
  // mapping-categorie-2044.ts.
  describe("calculerRevenus2044PourBien (biens en nom propre)", () => {
    async function creerBienNomPropre(nomProprietaire: string) {
      return bienService.create(userId, {
        type: "maison",
        proprietaireType: "personne_physique",
        nomProprietaire,
        adresse: "10 rue de la Maison",
        codePostal: "75002",
        ville: "Paris"
      });
    }

    it("rejette un bien détenu par une SCI — hors périmètre du formulaire 2044", async () => {
      const sci = await scisService.create(userId, {
        nom: "SCI 2044 Rejet Test",
        regimeFiscal: "IR",
        adresse: "1 rue de Test",
        codePostal: "75001",
        ville: "Paris"
      });
      const bienSci = await creerBienAvecLots(sci.id, "Immeuble SCI", 1);

      await expect(fiscaliteService.calculerRevenus2044PourBien(userId, bienSci.id, 2026)).rejects.toThrow(
        /nom propre/
      );
    });

    // Module Régularisation des charges, Sous-commit A (2026-09-30) : même
    // vérification que côté Annexe 1 — une dépense rattachée à un
    // appartement précis reste comptée normalement dans le formulaire 2044
    // du bien, aucun changement de comportement.
    it("compte toujours une dépense rattachée à un appartement précis dans le formulaire 2044 du bien", async () => {
      const bienNomPropre = await creerBienNomPropre("Marie Martin");
      const appartement = await appartementsService.create({
        bienId: bienNomPropre.id,
        numero: "unique",
        type: "T3",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel"
      });

      await depensesService.create(userId, {
        categorie: "reparation_entretien",
        montant: "55.00",
        dateDepense: "2026-06-01",
        libelle: "Réparation logement unique",
        appartementId: appartement.id
      });

      const resultat = await fiscaliteService.calculerRevenus2044PourBien(userId, bienNomPropre.id, 2026);

      expect(resultat.lignes.ligne224).toBe("55.00");
      expect(resultat.lignes.ligne240).toBe("55.00");
    });

    it("agrège les 4 catégories automatiques sur 240, ignore charges_copropriete/interets_emprunt, et calcule 261/263", async () => {
      const bienNomPropre = await creerBienNomPropre("Jean Dupont");

      await depensesService.create(userId, {
        categorie: "frais_gestion",
        montant: "100.00",
        dateDepense: "2026-03-01",
        libelle: "Frais de gestion",
        bienId: bienNomPropre.id
      });
      await depensesService.create(userId, {
        categorie: "assurance",
        montant: "200.00",
        dateDepense: "2026-04-01",
        libelle: "Assurance PNO",
        bienId: bienNomPropre.id
      });
      await depensesService.create(userId, {
        categorie: "reparation_entretien",
        montant: "300.00",
        dateDepense: "2026-05-01",
        libelle: "Réparation toiture",
        bienId: bienNomPropre.id
      });
      await depensesService.create(userId, {
        categorie: "impots_taxes",
        montant: "400.00",
        dateDepense: "2026-06-01",
        libelle: "Taxe foncière",
        bienId: bienNomPropre.id
      });
      // Hors périmètre de cette tranche (voir mapping-categorie-2044.ts) —
      // ne doit apparaître nulle part dans le résultat.
      await depensesService.create(userId, {
        categorie: "charges_copropriete",
        montant: "999.00",
        dateDepense: "2026-07-01",
        libelle: "Charges de copropriété",
        bienId: bienNomPropre.id
      });
      await depensesService.create(userId, {
        categorie: "interets_emprunt",
        montant: "999.00",
        dateDepense: "2026-08-01",
        libelle: "Intérêts d'emprunt",
        bienId: bienNomPropre.id
      });
      // Hors année civile 2026 — ne doit pas être compté.
      await depensesService.create(userId, {
        categorie: "frais_gestion",
        montant: "999.00",
        dateDepense: "2025-12-31",
        libelle: "Frais de gestion année précédente",
        bienId: bienNomPropre.id
      });

      const resultat = await fiscaliteService.calculerRevenus2044PourBien(userId, bienNomPropre.id, 2026);

      expect(resultat.bienId).toBe(bienNomPropre.id);
      expect(resultat.lignes.ligne211).toBe("0.00");
      expect(resultat.lignes.ligne215).toBe("0.00");
      expect(resultat.lignes.ligne221).toBe("100.00");
      expect(resultat.lignes.ligne223).toBe("200.00");
      expect(resultat.lignes.ligne224).toBe("300.00");
      expect(resultat.lignes.ligne227).toBe("400.00");
      // 240 = 100+200+300+400 = 1000.00 (charges_copropriete/interets_emprunt
      // volontairement absents de cette somme).
      expect(resultat.lignes.ligne240).toBe("1000.00");
      // 261 = 215-240 = 0-1000
      expect(resultat.lignes.ligne261).toBe("-1000.00");
      expect(resultat.lignes.ligne263).toBe("-1000.00");
    });
  });
});
