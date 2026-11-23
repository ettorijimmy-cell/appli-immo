import { describe, expect, it } from "vitest";
import { recalculerEcheanceMoisFin } from "./cloture-financiere-resiliation";
import {
  dateFinPreavisProposee,
  dureePreavisProposee,
  echeanceRecurrenteAGenerer,
  planRealignementEcheances,
  refusDateFinResiliationApresPreavis,
  RefusRealignement,
  validerDeclarationPreavis,
  type BailGenerationEcheance,
  type BailRealignement,
  type EcheanceARealigner
} from "./preavis";

// Bail de l'audit du 2026-11-15 : 550 € = 500 + 50, échéance le 5, entré
// le 01/10/2026.
const BAIL: BailRealignement = { loyerMensuel: "500.00", provisionsCharges: "50.00", dateDebut: "2026-10-01", jourEcheance: 5 };
const BAIL_JOB: BailGenerationEcheance = { ...BAIL, statut: "preavis", dateFin: "2027-04-15" };

const versement = (montant: string, archive = false) => ({ montant, archivedAt: archive ? "2027-04-20T10:00:00.000Z" : null });

function echeance(
  id: string,
  dateEcheance: string,
  montant: string,
  loyerHorsCharges: string | null,
  charges: string | null,
  options: Partial<Pick<EcheanceARealigner, "statut" | "versements" | "remboursements">> = {}
): EcheanceARealigner {
  return {
    id,
    dateEcheance,
    montant,
    loyerHorsCharges,
    charges,
    statut: options.statut ?? "impaye",
    versements: options.versements ?? [],
    remboursements: options.remboursements ?? []
  };
}

const FEVRIER = echeance("fev", "2027-02-05", "550.00", "500.00", "50.00");
const MARS = echeance("mars", "2027-03-05", "550.00", "500.00", "50.00");
const AVRIL_PRORATA = echeance("avr", "2027-04-05", "275.00", "250.00", "25.00");

describe("dureePreavisProposee", () => {
  it("vide : locataire 3 mois, ou 1 mois avec un motif ; bailleur 6 mois", () => {
    expect(dureePreavisProposee("vide", "locataire")).toBe(3);
    expect(dureePreavisProposee("vide", "locataire", "zone_tendue")).toBe(1);
    expect(dureePreavisProposee("vide", "locataire", "sante")).toBe(1);
    expect(dureePreavisProposee("vide", "bailleur")).toBe(6);
  });

  it("meublé : locataire 1 mois ; bailleur 3 mois", () => {
    expect(dureePreavisProposee("meuble", "locataire")).toBe(1);
    expect(dureePreavisProposee("meuble", "bailleur")).toBe(3);
  });

  it("refuse un motif hors congé du locataire sur un bail vide", () => {
    expect(() => dureePreavisProposee("vide", "bailleur", "mutation")).toThrow(/locataire sur un bail vide/);
    expect(() => dureePreavisProposee("meuble", "locataire", "mutation")).toThrow(/locataire sur un bail vide/);
  });
});

describe("dateFinPreavisProposee (proposée, à confirmer)", () => {
  it("réception + durée, même quantième", () => {
    expect(dateFinPreavisProposee("2027-01-15", 3)).toBe("2027-04-15");
    expect(dateFinPreavisProposee("2027-01-10", 6)).toBe("2027-07-10");
  });

  it("fin de mois : ramenée au dernier jour du mois (31/01 + 1 mois → 28/02, 29/02 en année bissextile)", () => {
    expect(dateFinPreavisProposee("2027-01-31", 1)).toBe("2027-02-28");
    expect(dateFinPreavisProposee("2028-01-31", 1)).toBe("2028-02-29");
    expect(dateFinPreavisProposee("2027-03-31", 3)).toBe("2027-06-30");
    expect(dateFinPreavisProposee("2027-11-30", 3)).toBe("2028-02-29");
  });

  it("refuse une durée ou une date invalide", () => {
    expect(() => dateFinPreavisProposee("2027-01-15", 0)).toThrow(/Durée/);
    expect(() => dateFinPreavisProposee("2027-01-15", 7)).toThrow(/Durée/);
    expect(() => dateFinPreavisProposee("2027-01-15", 1.5)).toThrow(/Durée/);
    expect(() => dateFinPreavisProposee("2027-02-30", 1)).toThrow(/invalide/);
  });
});

describe("validerDeclarationPreavis", () => {
  const declaration = {
    typeBail: "vide" as const,
    auteur: "locataire" as const,
    motifReduit: null,
    dureeMois: 3,
    dateReception: "2027-01-15",
    dateFin: "2027-04-15",
    dateDebutBail: "2026-10-01"
  };

  it("déclaration cohérente : aucun problème (durée et date de fin libres)", () => {
    expect(validerDeclarationPreavis(declaration)).toEqual([]);
    expect(validerDeclarationPreavis({ ...declaration, dureeMois: 2, dateFin: "2027-04-14" })).toEqual([]);
    expect(validerDeclarationPreavis({ ...declaration, motifReduit: "mutation", dureeMois: 1, dateFin: "2027-02-15" })).toEqual(
      []
    );
  });

  it("motif hors congé du locataire sur un bail vide", () => {
    expect(validerDeclarationPreavis({ ...declaration, auteur: "bailleur", motifReduit: "mutation" })).toEqual([
      "Un motif de préavis réduit ne vaut que pour un congé du locataire sur un bail vide."
    ]);
    expect(validerDeclarationPreavis({ ...declaration, typeBail: "meuble", motifReduit: "sante" })).toHaveLength(1);
  });

  it("dates incohérentes ou invalides, durée hors bornes", () => {
    expect(validerDeclarationPreavis({ ...declaration, dateFin: "2027-01-14" })).toEqual([
      "La date de fin du préavis ne peut pas précéder la date de réception du congé."
    ]);
    expect(validerDeclarationPreavis({ ...declaration, dateReception: "2026-09-30" })).toEqual([
      "La date de réception du congé ne peut pas précéder la date de début du bail."
    ]);
    expect(validerDeclarationPreavis({ ...declaration, dateFin: "2027-02-30" })).toEqual([
      "La date de fin du préavis doit être une date valide (AAAA-MM-JJ)."
    ]);
    expect(validerDeclarationPreavis({ ...declaration, dureeMois: 0 })).toEqual([
      "La durée du préavis doit être un nombre entier de mois, de 1 à 6."
    ]);
  });
});

describe("refusDateFinResiliationApresPreavis (décision 10)", () => {
  it("§4 d : résiliation au 20/05 pour un préavis fini le 15/04 : refusée", () => {
    expect(refusDateFinResiliationApresPreavis("2027-05-20", "2027-04-15")).toBe(
      "Résiliez au plus tard à la date de fin du préavis (15/04/2027) : l'occupation au-delà relève d'une indemnité d'occupation, à gérer à part."
    );
  });

  it("à la date de fin du préavis ou avant (relocation) : acceptée ; sans préavis : rien à refuser", () => {
    expect(refusDateFinResiliationApresPreavis("2027-04-15", "2027-04-15")).toBeNull();
    expect(refusDateFinResiliationApresPreavis("2027-03-31", "2027-04-15")).toBeNull();
    expect(refusDateFinResiliationApresPreavis("2027-05-20", null)).toBeNull();
  });
});

describe("echeanceRecurrenteAGenerer (job, décision 8)", () => {
  it("préavis fini le 15/04/2027 : mars plein, avril au prorata (275,00 = 250 + 25), mai rien", () => {
    expect(echeanceRecurrenteAGenerer(BAIL_JOB, "2027-03-01")).toEqual({
      type: "pleine",
      dateEcheance: "2027-03-05",
      montant: "550.00",
      loyerHorsCharges: "500.00",
      charges: "50.00"
    });
    expect(echeanceRecurrenteAGenerer(BAIL_JOB, "2027-04-01")).toEqual({
      type: "prorata",
      dateEcheance: "2027-04-05",
      montant: "275.00",
      loyerHorsCharges: "250.00",
      charges: "25.00"
    });
    expect(echeanceRecurrenteAGenerer(BAIL_JOB, "2027-05-01")).toEqual({ type: "aucune" });
  });

  it("congé du bailleur (fin 10/07/2027) : mai plein ; juillet au prorata (177,41 = 161,29 + 16,12)", () => {
    const bail = { ...BAIL_JOB, dateFin: "2027-07-10" };
    expect(echeanceRecurrenteAGenerer(bail, "2027-05-01")).toMatchObject({ type: "pleine", montant: "550.00" });
    expect(echeanceRecurrenteAGenerer(bail, "2027-07-01")).toMatchObject({
      type: "prorata",
      montant: "177.41",
      loyerHorsCharges: "161.29",
      charges: "16.12"
    });
  });

  it("bail ACTIF avec une date de fin : toujours plein, même après (comportement inchangé)", () => {
    expect(echeanceRecurrenteAGenerer({ ...BAIL_JOB, statut: "actif" }, "2027-05-01")).toMatchObject({
      type: "pleine",
      montant: "550.00"
    });
  });

  it("aucune : bail résilié, brouillon, loyer ou jour absent, mois avant la date de début", () => {
    expect(echeanceRecurrenteAGenerer({ ...BAIL_JOB, statut: "resilie" }, "2027-03-01")).toEqual({ type: "aucune" });
    expect(echeanceRecurrenteAGenerer({ ...BAIL_JOB, statut: "brouillon" }, "2027-03-01")).toEqual({ type: "aucune" });
    expect(echeanceRecurrenteAGenerer({ ...BAIL_JOB, loyerMensuel: null }, "2027-03-01")).toEqual({ type: "aucune" });
    expect(echeanceRecurrenteAGenerer({ ...BAIL_JOB, jourEcheance: null }, "2027-03-01")).toEqual({ type: "aucune" });
    expect(echeanceRecurrenteAGenerer(BAIL_JOB, "2026-09-15")).toEqual({ type: "aucune" });
  });

  it("refuse une date invalide", () => {
    expect(() => echeanceRecurrenteAGenerer(BAIL_JOB, "2027-02-30")).toThrow(/invalide/);
  });
});

describe("cohérence avec la résiliation (audit §4)", () => {
  it("§4 a : résiliation à la date de fin du préavis — même prorata que le job, aucun double prorata", () => {
    const genere = echeanceRecurrenteAGenerer(BAIL_JOB, "2027-04-01");
    const resiliation = recalculerEcheanceMoisFin({ statut: "impaye", versements: [] }, BAIL, "2027-04-15");
    expect(resiliation.miseAJour).toEqual({ montant: "275.00", loyerHorsCharges: "250.00", charges: "25.00", statut: "impaye" });
    expect(genere).toMatchObject({ montant: "275.00", loyerHorsCharges: "250.00", charges: "25.00" });
  });

  it("§4 b : fin avancée au 31/03 (relocation) : mars plein inchangé, avril proratisé archivé sans versement", () => {
    const plan = planRealignementEcheances({
      bail: BAIL,
      ancienneFin: "2027-04-15",
      nouvelleFin: "2027-03-31",
      echeances: [FEVRIER, MARS, AVRIL_PRORATA],
      dateReference: "2027-04-02"
    });
    expect(plan).toEqual({ miseAJour: [], archivages: ["avr"], conservations: [], creations: [], tropPercuMoisFin: null });
  });

  it("§4 b : avril déjà payé 275 € (dont 100 € remboursés) : gardé, trop-perçu 275,00, reste 175,00", () => {
    const plan = planRealignementEcheances({
      bail: BAIL,
      ancienneFin: "2027-04-15",
      nouvelleFin: "2027-03-31",
      echeances: [
        MARS,
        echeance("avr", "2027-04-05", "275.00", "250.00", "25.00", {
          statut: "paye",
          versements: [versement("275.00")],
          remboursements: [{ montantRembourse: "100.00", archivedAt: null }]
        })
      ],
      dateReference: "2027-04-02"
    });
    expect(plan.archivages).toEqual([]);
    expect(plan.conservations).toEqual([
      { paiementId: "avr", dateEcheance: "2027-04-05", montant: "275.00", tropPercu: "275.00", resteARembourser: "175.00" }
    ]);
  });

  it("§4 c : congé du bailleur, départ réel le 20/05 : mai (plein, généré par le job) ramené à 354,83 par la résiliation", () => {
    const bail = { ...BAIL_JOB, dateFin: "2027-07-10" };
    expect(echeanceRecurrenteAGenerer(bail, "2027-05-01")).toMatchObject({ type: "pleine", montant: "550.00" });
    expect(recalculerEcheanceMoisFin({ statut: "impaye", versements: [] }, BAIL, "2027-05-20").miseAJour).toEqual({
      montant: "354.83",
      loyerHorsCharges: "322.58",
      charges: "32.25",
      statut: "impaye"
    });
  });
});

describe("planRealignementEcheances", () => {
  describe("déclaration tardive (avril déjà généré plein le 01/04, préavis saisi le 02/04, fin 15/04)", () => {
    const avrilPlein = (options: Parameters<typeof echeance>[5] = {}) =>
      echeance("avr", "2027-04-05", "550.00", "500.00", "50.00", options);

    it("avril impayé : ramené au prorata 275,00 (250 + 25)", () => {
      const plan = planRealignementEcheances({
        bail: BAIL,
        ancienneFin: null,
        nouvelleFin: "2027-04-15",
        echeances: [MARS, avrilPlein()],
        dateReference: "2027-04-02"
      });
      expect(plan).toEqual({
        miseAJour: [{ paiementId: "avr", montant: "275.00", loyerHorsCharges: "250.00", charges: "25.00", statut: "impaye" }],
        archivages: [],
        conservations: [],
        creations: [],
        tropPercuMoisFin: null
      });
    });

    it("avril payé 550 € : inchangé (règle de la résiliation), trop-perçu 275,00", () => {
      const plan = planRealignementEcheances({
        bail: BAIL,
        ancienneFin: null,
        nouvelleFin: "2027-04-15",
        echeances: [avrilPlein({ statut: "paye", versements: [versement("550.00")] })],
        dateReference: "2027-04-02"
      });
      expect(plan.miseAJour).toEqual([]);
      expect(plan.tropPercuMoisFin).toEqual({ paiementId: "avr", tropPercu: "275.00", resteARembourser: "275.00" });
    });

    it("avril partiel 300 € : 275,00, passe payé, trop-perçu 25,00", () => {
      const plan = planRealignementEcheances({
        bail: BAIL,
        ancienneFin: null,
        nouvelleFin: "2027-04-15",
        echeances: [avrilPlein({ statut: "partiel", versements: [versement("300.00")] })],
        dateReference: "2027-04-02"
      });
      expect(plan.miseAJour).toEqual([
        { paiementId: "avr", montant: "275.00", loyerHorsCharges: "250.00", charges: "25.00", statut: "paye" }
      ]);
      expect(plan.tropPercuMoisFin?.tropPercu).toBe("25.00");
    });

    it("un mois après la fin déjà présent (saisi à la main) : archivé sans versement", () => {
      const plan = planRealignementEcheances({
        bail: BAIL,
        ancienneFin: null,
        nouvelleFin: "2027-04-15",
        echeances: [avrilPlein(), echeance("mai", "2027-05-05", "550.00", "500.00", "50.00", { versements: [versement("50.00", true)] })],
        dateReference: "2027-05-02"
      });
      expect(plan.archivages).toEqual(["mai"]);
    });

    it("déjà aligné (déclaration rejouée) : plan vide", () => {
      const plan = planRealignementEcheances({
        bail: BAIL,
        ancienneFin: null,
        nouvelleFin: "2027-04-15",
        echeances: [MARS, AVRIL_PRORATA],
        dateReference: "2027-04-02"
      });
      expect(plan).toEqual({ miseAJour: [], archivages: [], conservations: [], creations: [], tropPercuMoisFin: null });
    });
  });

  describe("date reculée (décision 9)", () => {
    const avrilPaye275 = echeance("avr", "2027-04-05", "275.00", "250.00", "25.00", {
      statut: "paye",
      versements: [versement("275.00")]
    });

    it("dans le même mois (15/04 → 30/04) : avril payé 275 remis plein 550 MÊME payé, statut partiel", () => {
      const plan = planRealignementEcheances({
        bail: BAIL,
        ancienneFin: "2027-04-15",
        nouvelleFin: "2027-04-30",
        echeances: [MARS, avrilPaye275],
        dateReference: "2027-04-20"
      });
      expect(plan.miseAJour).toEqual([
        { paiementId: "avr", montant: "550.00", loyerHorsCharges: "500.00", charges: "50.00", statut: "partiel" }
      ]);
      expect(plan.creations).toEqual([]);
      expect(plan.tropPercuMoisFin).toBeNull();
    });

    it("au mois suivant (15/04 → 15/05), le 10/05 : avril remis plein (partiel), mai créé au prorata 266,12 (241,93 + 24,19)", () => {
      const plan = planRealignementEcheances({
        bail: BAIL,
        ancienneFin: "2027-04-15",
        nouvelleFin: "2027-05-15",
        echeances: [MARS, avrilPaye275],
        dateReference: "2027-05-10"
      });
      expect(plan.miseAJour).toEqual([
        { paiementId: "avr", montant: "550.00", loyerHorsCharges: "500.00", charges: "50.00", statut: "partiel" }
      ]);
      expect(plan.creations).toEqual([
        { dateEcheance: "2027-05-05", montant: "266.12", loyerHorsCharges: "241.93", charges: "24.19" }
      ]);
    });

    it("mois futur : rien n'est créé (le job le générera au prorata)", () => {
      const plan = planRealignementEcheances({
        bail: BAIL,
        ancienneFin: "2027-04-15",
        nouvelleFin: "2027-05-15",
        echeances: [MARS, avrilPaye275],
        dateReference: "2027-04-20"
      });
      expect(plan.creations).toEqual([]);
      expect(plan.miseAJour).toHaveLength(1);
    });

    it("plusieurs mois passés (15/04 → 15/07, le 10/06) : mai et juin créés pleins, juillet laissé au job", () => {
      const plan = planRealignementEcheances({
        bail: BAIL,
        ancienneFin: "2027-04-15",
        nouvelleFin: "2027-07-15",
        echeances: [MARS, AVRIL_PRORATA],
        dateReference: "2027-06-10"
      });
      expect(plan.creations).toEqual([
        { dateEcheance: "2027-05-05", montant: "550.00", loyerHorsCharges: "500.00", charges: "50.00" },
        { dateEcheance: "2027-06-05", montant: "550.00", loyerHorsCharges: "500.00", charges: "50.00" }
      ]);
      expect(plan.miseAJour).toEqual([
        { paiementId: "avr", montant: "550.00", loyerHorsCharges: "500.00", charges: "50.00", statut: "impaye" }
      ]);
    });

    it("un mois dont l'échéance est archivée compte comme manquant (l'archivée n'est pas désarchivée)", () => {
      // Mai archivé auparavant : absent de la liste (seules les non
      // archivées sont fournies) — une nouvelle échéance est créée.
      const plan = planRealignementEcheances({
        bail: BAIL,
        ancienneFin: "2027-04-15",
        nouvelleFin: "2027-05-31",
        echeances: [MARS, AVRIL_PRORATA],
        dateReference: "2027-05-10"
      });
      expect(plan.creations).toEqual([
        { dateEcheance: "2027-05-05", montant: "550.00", loyerHorsCharges: "500.00", charges: "50.00" }
      ]);
      expect(plan.archivages).toEqual([]);
    });
  });

  describe("annulation (décision 13)", () => {
    it("le 10/05 : avril payé 275 remis plein (partiel), mai créé plein", () => {
      const plan = planRealignementEcheances({
        bail: BAIL,
        ancienneFin: "2027-04-15",
        nouvelleFin: null,
        echeances: [
          MARS,
          echeance("avr", "2027-04-05", "275.00", "250.00", "25.00", { statut: "paye", versements: [versement("275.00")] })
        ],
        dateReference: "2027-05-10"
      });
      expect(plan).toEqual({
        miseAJour: [{ paiementId: "avr", montant: "550.00", loyerHorsCharges: "500.00", charges: "50.00", statut: "partiel" }],
        archivages: [],
        conservations: [],
        creations: [{ dateEcheance: "2027-05-05", montant: "550.00", loyerHorsCharges: "500.00", charges: "50.00" }],
        tropPercuMoisFin: null
      });
    });

    it("avant le mois de fin (le 20/03) : rien à recalculer ni à créer (le job générera avril plein)", () => {
      const plan = planRealignementEcheances({
        bail: BAIL,
        ancienneFin: "2027-04-15",
        nouvelleFin: null,
        echeances: [FEVRIER, MARS],
        dateReference: "2027-03-20"
      });
      expect(plan).toEqual({ miseAJour: [], archivages: [], conservations: [], creations: [], tropPercuMoisFin: null });
    });

    it("ancien mois de fin = mois d'entrée : remis au prorata d'entrée (10 → 31/03 : 390,32 = 354,84 + 35,48)", () => {
      const bail = { ...BAIL, dateDebut: "2027-03-10" };
      const plan = planRealignementEcheances({
        bail,
        ancienneFin: "2027-03-20",
        nouvelleFin: null,
        echeances: [echeance("mars", "2027-03-10", "195.16", "177.42", "17.74")],
        dateReference: "2027-03-25"
      });
      expect(plan.miseAJour).toEqual([
        { paiementId: "mars", montant: "390.32", loyerHorsCharges: "354.84", charges: "35.48", statut: "impaye" }
      ]);
      expect(plan.creations).toEqual([]);
    });
  });

  describe("refus", () => {
    it("deux échéances non archivées dans un mois concerné", () => {
      expect(() =>
        planRealignementEcheances({
          bail: BAIL,
          ancienneFin: null,
          nouvelleFin: "2027-04-15",
          echeances: [AVRIL_PRORATA, echeance("avr2", "2027-04-20", "550.00", "500.00", "50.00")],
          dateReference: "2027-04-21"
        })
      ).toThrow(/Plusieurs échéances de loyer \(2\)/);
    });

    it("ni ancienne ni nouvelle fin, date avant le début du bail, date invalide", () => {
      const base = { bail: BAIL, echeances: [], dateReference: "2027-04-02" };
      expect(() => planRealignementEcheances({ ...base, ancienneFin: null, nouvelleFin: null })).toThrow(/ni ancienne ni nouvelle/);
      expect(() => planRealignementEcheances({ ...base, ancienneFin: null, nouvelleFin: "2026-09-30" })).toThrow(/précède/);
      expect(() => planRealignementEcheances({ ...base, ancienneFin: null, nouvelleFin: "2027-04-31" })).toThrow(/invalide/);
    });

    it("versement actif négatif : erreur (garde-fou du commit 8b6fb9f)", () => {
      expect(() =>
        planRealignementEcheances({
          bail: BAIL,
          ancienneFin: "2027-04-15",
          nouvelleFin: "2027-03-31",
          echeances: [echeance("avr", "2027-04-05", "275.00", "250.00", "25.00", { versements: [versement("-5.00")] })],
          dateReference: "2027-04-02"
        })
      ).toThrow(/négatif/);
    });
  });
});

describe("corrections de la revue financial-logic-reviewer", () => {
  const avrilPaye275 = () =>
    echeance("avr", "2027-04-05", "275.00", "250.00", "25.00", { statut: "paye", versements: [versement("275.00")] });

  it("bloquant : fin avancée (15/04 → 31/03, avril payé 275 gardé) puis reculée au 15/05 le 10/05 : avril remis plein (partiel), mai créé au prorata", () => {
    const plan = planRealignementEcheances({
      bail: BAIL,
      ancienneFin: "2027-03-31",
      nouvelleFin: "2027-05-15",
      echeances: [MARS, avrilPaye275()],
      dateReference: "2027-05-10"
    });
    expect(plan.miseAJour).toEqual([
      { paiementId: "avr", montant: "550.00", loyerHorsCharges: "500.00", charges: "50.00", statut: "partiel" }
    ]);
    expect(plan.creations).toEqual([{ dateEcheance: "2027-05-05", montant: "266.12", loyerHorsCharges: "241.93", charges: "24.19" }]);
  });

  it("bloquant, variante annulation : avril gardé après une fin avancée au 31/03 redevient plein", () => {
    const plan = planRealignementEcheances({
      bail: BAIL,
      ancienneFin: "2027-03-31",
      nouvelleFin: null,
      echeances: [MARS, avrilPaye275()],
      dateReference: "2027-05-10"
    });
    expect(plan.miseAJour).toEqual([
      { paiementId: "avr", montant: "550.00", loyerHorsCharges: "500.00", charges: "50.00", statut: "partiel" }
    ]);
    expect(plan.creations).toEqual([{ dateEcheance: "2027-05-05", montant: "550.00", loyerHorsCharges: "500.00", charges: "50.00" }]);
  });

  it("versement actif négatif refusé sur le mois de fin et sur l'ancien mois de fin", () => {
    const negatif = echeance("avr", "2027-04-05", "550.00", "500.00", "50.00", { versements: [versement("-5.00")] });
    expect(() =>
      planRealignementEcheances({ bail: BAIL, ancienneFin: null, nouvelleFin: "2027-04-15", echeances: [negatif], dateReference: "2027-04-02" })
    ).toThrow(/négatif/);
    const negatifProrata = echeance("avr", "2027-04-05", "275.00", "250.00", "25.00", { versements: [versement("-5.00")] });
    expect(() =>
      planRealignementEcheances({ bail: BAIL, ancienneFin: "2027-04-15", nouvelleFin: null, echeances: [negatifProrata], dateReference: "2027-05-10" })
    ).toThrow(/négatif/);
  });

  it("bail en préavis sans date de fin : incohérence, erreur (jamais un mois plein)", () => {
    expect(() => echeanceRecurrenteAGenerer({ ...BAIL_JOB, dateFin: null }, "2027-03-01")).toThrow(/sans date de fin/);
  });

  it("hors recul, une échéance PAYÉE n'est jamais remontée (déclaration avec avril payé 200 €)", () => {
    const plan = planRealignementEcheances({
      bail: BAIL,
      ancienneFin: null,
      nouvelleFin: "2027-04-15",
      echeances: [echeance("avr", "2027-04-05", "200.00", "180.00", "20.00", { statut: "paye", versements: [versement("200.00")] })],
      dateReference: "2027-04-02"
    });
    expect(plan.miseAJour).toEqual([]);
    expect(plan.tropPercuMoisFin).toBeNull();
  });

  it("déclaration avec un mois de fin passé et sans échéance : rien n'est créé (relais : résiliation, Cas B)", () => {
    const plan = planRealignementEcheances({
      bail: BAIL,
      ancienneFin: null,
      nouvelleFin: "2027-04-15",
      echeances: [MARS],
      dateReference: "2027-05-10"
    });
    expect(plan).toEqual({ miseAJour: [], archivages: [], conservations: [], creations: [], tropPercuMoisFin: null });
  });

  it("recul avec l'ancien mois de fin absent (archivé) : il est recréé plein", () => {
    const plan = planRealignementEcheances({
      bail: BAIL,
      ancienneFin: "2027-04-15",
      nouvelleFin: "2027-05-15",
      echeances: [MARS],
      dateReference: "2027-05-10"
    });
    expect(plan.creations).toEqual([
      { dateEcheance: "2027-04-05", montant: "550.00", loyerHorsCharges: "500.00", charges: "50.00" },
      { dateEcheance: "2027-05-05", montant: "266.12", loyerHorsCharges: "241.93", charges: "24.19" }
    ]);
  });

  it("deux échéances dans un mois après la nouvelle fin : traitées une à une (archivée et gardée)", () => {
    const plan = planRealignementEcheances({
      bail: BAIL,
      ancienneFin: "2027-04-15",
      nouvelleFin: "2027-03-31",
      echeances: [
        MARS,
        AVRIL_PRORATA,
        echeance("avr2", "2027-04-20", "100.00", null, null, { statut: "paye", versements: [versement("100.00")] })
      ],
      dateReference: "2027-04-21"
    });
    expect(plan.archivages).toEqual(["avr"]);
    expect(plan.conservations.map((c) => [c.paiementId, c.tropPercu])).toEqual([["avr2", "100.00"]]);
  });

  it("fin avancée dans le même mois (15/04 → 10/04) : avril payé 275 inchangé, trop-perçu 91,67 ; impayé ramené à 183,33", () => {
    const paye = planRealignementEcheances({
      bail: BAIL,
      ancienneFin: "2027-04-15",
      nouvelleFin: "2027-04-10",
      echeances: [avrilPaye275()],
      dateReference: "2027-04-11"
    });
    expect(paye.miseAJour).toEqual([]);
    expect(paye.tropPercuMoisFin).toEqual({ paiementId: "avr", tropPercu: "91.67", resteARembourser: "91.67" });

    const impaye = planRealignementEcheances({
      bail: BAIL,
      ancienneFin: "2027-04-15",
      nouvelleFin: "2027-04-10",
      echeances: [AVRIL_PRORATA],
      dateReference: "2027-04-11"
    });
    expect(impaye.miseAJour).toEqual([
      { paiementId: "avr", montant: "183.33", loyerHorsCharges: "166.67", charges: "16.66", statut: "impaye" }
    ]);
  });

  it("versements et remboursements archivés sur le mois de fin : seuls les actifs comptent", () => {
    const plan = planRealignementEcheances({
      bail: BAIL,
      ancienneFin: null,
      nouvelleFin: "2027-04-15",
      echeances: [
        echeance("avr", "2027-04-05", "550.00", "500.00", "50.00", {
          statut: "paye",
          versements: [versement("550.00"), versement("100.00", true)],
          remboursements: [{ montantRembourse: "275.00", archivedAt: "2027-04-21T09:00:00.000Z" }]
        })
      ],
      dateReference: "2027-04-02"
    });
    expect(plan.tropPercuMoisFin).toEqual({ paiementId: "avr", tropPercu: "275.00", resteARembourser: "275.00" });
  });

  it("sans provisions : job et réalignement (charges à 0,00)", () => {
    expect(echeanceRecurrenteAGenerer({ ...BAIL_JOB, provisionsCharges: null }, "2027-04-01")).toEqual({
      type: "prorata",
      dateEcheance: "2027-04-05",
      montant: "250.00",
      loyerHorsCharges: "250.00",
      charges: "0.00"
    });
    const plan = planRealignementEcheances({
      bail: { ...BAIL, provisionsCharges: null },
      ancienneFin: "2027-04-15",
      nouvelleFin: null,
      echeances: [echeance("avr", "2027-04-05", "250.00", "250.00", "0.00")],
      dateReference: "2027-04-20"
    });
    expect(plan.miseAJour).toEqual([
      { paiementId: "avr", montant: "500.00", loyerHorsCharges: "500.00", charges: "0.00", statut: "impaye" }
    ]);
  });

  it("annulation un jour du mois de l'ancien mois de fin (le 20/04) : avril remis plein, rien créé", () => {
    const plan = planRealignementEcheances({
      bail: BAIL,
      ancienneFin: "2027-04-15",
      nouvelleFin: null,
      echeances: [MARS, AVRIL_PRORATA],
      dateReference: "2027-04-20"
    });
    expect(plan.miseAJour).toEqual([
      { paiementId: "avr", montant: "550.00", loyerHorsCharges: "500.00", charges: "50.00", statut: "impaye" }
    ]);
    expect(plan.creations).toEqual([]);
  });

  it("recul de décembre à janvier (passage d'année)", () => {
    const plan = planRealignementEcheances({
      bail: BAIL,
      ancienneFin: "2027-12-15",
      nouvelleFin: "2028-01-15",
      echeances: [echeance("dec", "2027-12-05", "266.12", "241.93", "24.19")],
      dateReference: "2028-01-10"
    });
    expect(plan.miseAJour).toEqual([
      { paiementId: "dec", montant: "550.00", loyerHorsCharges: "500.00", charges: "50.00", statut: "impaye" }
    ]);
    expect(plan.creations).toEqual([{ dateEcheance: "2028-01-05", montant: "266.12", loyerHorsCharges: "241.93", charges: "24.19" }]);
  });

  it("création d'un mois de février avec un jour d'échéance au 28", () => {
    const plan = planRealignementEcheances({
      bail: { ...BAIL, jourEcheance: 28 },
      ancienneFin: "2027-01-15",
      nouvelleFin: null,
      echeances: [echeance("jan", "2027-01-28", "266.12", "241.93", "24.19")],
      dateReference: "2027-02-10"
    });
    expect(plan.creations).toEqual([{ dateEcheance: "2027-02-28", montant: "550.00", loyerHorsCharges: "500.00", charges: "50.00" }]);
  });

  it("job : préavis dont la date de fin tombe dans le mois d'entrée (10 → 20/03 : 195,16)", () => {
    expect(
      echeanceRecurrenteAGenerer({ ...BAIL_JOB, dateDebut: "2027-03-10", dateFin: "2027-03-20" }, "2027-03-01")
    ).toMatchObject({ type: "prorata", montant: "195.16", loyerHorsCharges: "177.42", charges: "17.74" });
  });
});

describe("revue du commit 3a : mois déjà remboursé remonté par un recul ou une annulation", () => {
  const avrilRembourse = (archive: boolean) =>
    echeance("avr", "2027-04-05", "275.00", "250.00", "25.00", {
      statut: "paye",
      versements: [versement("275.00")],
      remboursements: [{ montantRembourse: "275.00", archivedAt: archive ? "2027-04-21T09:00:00.000Z" : null }]
    });

  it("recul : avril gardé puis remboursé ne peut pas être remis plein — refus explicite (RefusRealignement)", () => {
    expect(() =>
      planRealignementEcheances({
        bail: BAIL,
        ancienneFin: "2027-03-31",
        nouvelleFin: "2027-05-15",
        echeances: [MARS, avrilRembourse(false)],
        dateReference: "2027-05-10"
      })
    ).toThrow(RefusRealignement);
  });

  it("annulation : même refus, avec la date de l'échéance dans le message", () => {
    expect(() =>
      planRealignementEcheances({
        bail: BAIL,
        ancienneFin: "2027-04-15",
        nouvelleFin: null,
        echeances: [MARS, avrilRembourse(false)],
        dateReference: "2027-04-20"
      })
    ).toThrow("Un trop-perçu de l'échéance du 05/04/2027 a déjà été remboursé. Si ce remboursement a été saisi par erreur, archivez-le (fiche du bail, section Remboursements). S'il a réellement été versé au locataire, la date de fin ne peut pas être reculée.");
  });

  it("recul dans le même mois (hausse du mois de fin) : même refus", () => {
    expect(() =>
      planRealignementEcheances({
        bail: BAIL,
        ancienneFin: "2027-04-15",
        nouvelleFin: "2027-04-30",
        echeances: [avrilRembourse(false)],
        dateReference: "2027-04-20"
      })
    ).toThrow(RefusRealignement);
  });

  it("remboursement archivé (annulé) : pas de refus, avril remis plein", () => {
    const plan = planRealignementEcheances({
      bail: BAIL,
      ancienneFin: "2027-04-15",
      nouvelleFin: null,
      echeances: [avrilRembourse(true)],
      dateReference: "2027-04-20"
    });
    expect(plan.miseAJour).toEqual([
      { paiementId: "avr", montant: "550.00", loyerHorsCharges: "500.00", charges: "50.00", statut: "partiel" }
    ]);
  });

  it("deux échéances le même mois : RefusRealignement (refus métier), pas une erreur ordinaire", () => {
    expect(() =>
      planRealignementEcheances({
        bail: BAIL,
        ancienneFin: null,
        nouvelleFin: "2027-04-15",
        echeances: [AVRIL_PRORATA, echeance("avr2", "2027-04-20", "550.00", "500.00", "50.00")],
        dateReference: "2027-04-21"
      })
    ).toThrow(RefusRealignement);
  });
});
