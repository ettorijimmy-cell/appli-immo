import { describe, expect, it } from "vitest";
import {
  calculerEcheanceMoisFinACreer,
  calculerResteARembourser,
  calculerTropPercuTotalResiliation,
  classerEcheanceParRapportAFin,
  classerEcheancesParRapportAFin,
  deciderEcheanceApresFin,
  estEcheanceMoisNonDu,
  recalculerEcheanceMoisFin,
  type BailClotureFinanciere,
  type BailPourQuittance
} from "./cloture-financiere-resiliation";

// Bail de l'audit du 2026-11-14 : 550 € charges comprises (500 + 50),
// échéance le 5, entré avant 2027.
const BAIL_550: BailClotureFinanciere = { loyerMensuel: "500.00", provisionsCharges: "50.00", dateDebut: "2026-10-01" };

const versement = (montant: string, archive = false) => ({
  montant,
  archivedAt: archive ? new Date("2027-04-20T10:00:00Z") : null
});

describe("classerEcheanceParRapportAFin", () => {
  it("classe selon le mois de la date d'échéance, pas le jour", () => {
    expect(classerEcheanceParRapportAFin("2027-02-05", "2027-03-15")).toBe("avant_mois_fin");
    expect(classerEcheanceParRapportAFin("2027-03-05", "2027-03-15")).toBe("mois_fin");
    expect(classerEcheanceParRapportAFin("2027-03-31", "2027-03-15")).toBe("mois_fin");
    expect(classerEcheanceParRapportAFin("2027-04-05", "2027-03-15")).toBe("apres_mois_fin");
  });

  it("l'échéance créée à la résiliation (datée de la date de fin) est dans le mois de fin", () => {
    expect(classerEcheanceParRapportAFin("2027-03-15", "2027-03-15")).toBe("mois_fin");
  });

  it("gère le passage d'année", () => {
    expect(classerEcheanceParRapportAFin("2027-01-05", "2026-12-31")).toBe("apres_mois_fin");
    expect(classerEcheanceParRapportAFin("2026-12-05", "2027-01-10")).toBe("avant_mois_fin");
  });

  it("refuse une date invalide", () => {
    expect(() => classerEcheanceParRapportAFin("2027-02-30", "2027-03-15")).toThrow();
    expect(() => classerEcheanceParRapportAFin("2027-04-05", "2027-03-15T00:00:00Z")).toThrow();
  });
});

describe("classerEcheancesParRapportAFin", () => {
  it("répartit les échéances en trois groupes, ordre conservé", () => {
    const echeances = [
      { id: "fev", dateEcheance: "2027-02-05" },
      { id: "avr", dateEcheance: "2027-04-05" },
      { id: "mars", dateEcheance: "2027-03-05" },
      { id: "mai", dateEcheance: "2027-05-05" }
    ];
    const resultat = classerEcheancesParRapportAFin(echeances, "2027-03-15");
    expect(resultat.avantMoisFin.map((e) => e.id)).toEqual(["fev"]);
    expect(resultat.moisFin.map((e) => e.id)).toEqual(["mars"]);
    expect(resultat.apresMoisFin.map((e) => e.id)).toEqual(["avr", "mai"]);
  });

  it("liste vide : trois groupes vides", () => {
    expect(classerEcheancesParRapportAFin([], "2027-03-15")).toEqual({ avantMoisFin: [], moisFin: [], apresMoisFin: [] });
  });
});

describe("deciderEcheanceApresFin (fin en mars, échéance d'avril à 550 €)", () => {
  it("avril impayé (aucun versement) : archiver", () => {
    expect(deciderEcheanceApresFin([])).toEqual({ decision: "archiver" });
  });

  it("avril partiel (200 € reçus) : conserver, trop-perçu 200,00", () => {
    expect(deciderEcheanceApresFin([versement("200.00")])).toEqual({ decision: "conserver", tropPercu: "200.00" });
  });

  it("avril payé (550 € reçus en deux fois) : conserver, trop-perçu 550,00", () => {
    expect(deciderEcheanceApresFin([versement("300.00"), versement("250.00")])).toEqual({
      decision: "conserver",
      tropPercu: "550.00"
    });
  });

  it("versements tous archivés : comme aucun versement, archiver", () => {
    expect(deciderEcheanceApresFin([versement("550.00", true)])).toEqual({ decision: "archiver" });
  });

  it("versements archivés ignorés dans le trop-perçu", () => {
    expect(deciderEcheanceApresFin([versement("200.00"), versement("350.00", true)])).toEqual({
      decision: "conserver",
      tropPercu: "200.00"
    });
  });
});

describe("recalculerEcheanceMoisFin (Cas A)", () => {
  it("fin le 15/03/2027, mars impayé : 266,12 € dont charges 24,19 et loyer 241,93, statut impayé", () => {
    expect(recalculerEcheanceMoisFin({ statut: "impaye", versements: [] }, BAIL_550, "2027-03-15")).toEqual({
      miseAJour: { montant: "266.12", loyerHorsCharges: "241.93", charges: "24.19", statut: "impaye" },
      tropPercu: "0.00"
    });
  });

  it("fin le 15/04/2027 (mois de 30 jours), avril impayé : 275,00 € (250 + 25)", () => {
    expect(recalculerEcheanceMoisFin({ statut: "impaye", versements: [] }, BAIL_550, "2027-04-15")).toEqual({
      miseAJour: { montant: "275.00", loyerHorsCharges: "250.00", charges: "25.00", statut: "impaye" },
      tropPercu: "0.00"
    });
  });

  it("mars partiel (100 € reçus) : reste partiel au prorata, pas de trop-perçu", () => {
    const resultat = recalculerEcheanceMoisFin({ statut: "partiel", versements: [versement("100.00")] }, BAIL_550, "2027-03-15");
    expect(resultat.miseAJour?.statut).toBe("partiel");
    expect(resultat.miseAJour?.montant).toBe("266.12");
    expect(resultat.tropPercu).toBe("0.00");
  });

  it("mars partiel (300 € reçus, plus que le prorata) : passe payé, trop-perçu 33,88", () => {
    expect(recalculerEcheanceMoisFin({ statut: "partiel", versements: [versement("300.00")] }, BAIL_550, "2027-03-15")).toEqual({
      miseAJour: { montant: "266.12", loyerHorsCharges: "241.93", charges: "24.19", statut: "paye" },
      tropPercu: "33.88"
    });
  });

  it("mars payé 550 € : inchangé, trop-perçu 283,88", () => {
    expect(recalculerEcheanceMoisFin({ statut: "paye", versements: [versement("550.00")] }, BAIL_550, "2027-03-15")).toEqual({
      miseAJour: null,
      tropPercu: "283.88"
    });
  });

  it("versements archivés ignorés (statut recalculé sur les seuls actifs)", () => {
    const resultat = recalculerEcheanceMoisFin(
      { statut: "partiel", versements: [versement("100.00"), versement("400.00", true)] },
      BAIL_550,
      "2027-03-15"
    );
    expect(resultat.miseAJour?.statut).toBe("partiel");
    expect(resultat.tropPercu).toBe("0.00");
  });

  it("fin le dernier jour du mois : montant plein, décomposition 500 + 50", () => {
    expect(recalculerEcheanceMoisFin({ statut: "impaye", versements: [] }, BAIL_550, "2027-03-31").miseAJour).toEqual({
      montant: "550.00",
      loyerHorsCharges: "500.00",
      charges: "50.00",
      statut: "impaye"
    });
  });

  it("même mois que la date de début : période date_debut → date_fin", () => {
    // Entrée le 10/03/2027, fin le 20/03/2027 : 11 jours sur 31.
    const bail = { ...BAIL_550, dateDebut: "2027-03-10" };
    expect(recalculerEcheanceMoisFin({ statut: "impaye", versements: [] }, bail, "2027-03-20").miseAJour).toEqual({
      montant: "195.16",
      loyerHorsCharges: "177.42",
      charges: "17.74",
      statut: "impaye"
    });
  });

  it("refuse une date de fin avant la date de début ou invalide", () => {
    expect(() => recalculerEcheanceMoisFin({ statut: "impaye", versements: [] }, BAIL_550, "2026-09-30")).toThrow();
    expect(() => recalculerEcheanceMoisFin({ statut: "impaye", versements: [] }, BAIL_550, "2027-02-29")).toThrow();
  });
});

describe("calculerEcheanceMoisFinACreer (Cas B)", () => {
  it("fin le 15/03/2027 : échéance à créer avec sa décomposition", () => {
    expect(calculerEcheanceMoisFinACreer(BAIL_550, "2027-03-15")).toEqual({
      montant: "266.12",
      loyerHorsCharges: "241.93",
      charges: "24.19"
    });
  });

  it("prorata nul (loyer et provisions à zéro) : rien à créer", () => {
    expect(calculerEcheanceMoisFinACreer({ loyerMensuel: "0.00", provisionsCharges: null, dateDebut: "2026-10-01" }, "2027-03-15")).toBeNull();
  });
});

describe("calculerTropPercuTotalResiliation", () => {
  it("mars payé 550 (283,88 de trop) + avril payé 550 conservé : 833,88", () => {
    expect(
      calculerTropPercuTotalResiliation("283.88", [{ decision: "conserver", tropPercu: "550.00" }])
    ).toBe("833.88");
  });

  it("additionne plusieurs mois conservés et ignore les mois archivés", () => {
    expect(
      calculerTropPercuTotalResiliation("0.00", [
        { decision: "conserver", tropPercu: "200.00" },
        { decision: "archiver" },
        { decision: "conserver", tropPercu: "550.00" }
      ])
    ).toBe("750.00");
  });

  it("aucun mois de fin (Cas B) et rien après : 0,00", () => {
    expect(calculerTropPercuTotalResiliation(null, [])).toBe("0.00");
  });
});

describe("estEcheanceMoisNonDu (quittance)", () => {
  const resilie: BailPourQuittance = { statut: "resilie", dateFin: "2027-03-15" };

  it("mois strictement après le mois de fin d'un bail résilié : non dû", () => {
    expect(estEcheanceMoisNonDu("2027-04-05", resilie)).toBe(true);
  });

  it("mois de fin et mois antérieurs : dus", () => {
    expect(estEcheanceMoisNonDu("2027-03-05", resilie)).toBe(false);
    expect(estEcheanceMoisNonDu("2027-02-05", resilie)).toBe(false);
  });

  it("bail archivé après sa résiliation : même règle", () => {
    expect(estEcheanceMoisNonDu("2027-04-05", { statut: "archive", dateFin: "2027-03-15" })).toBe(true);
  });

  it("bail actif ou en préavis (même avec une date de fin) : jamais non dû", () => {
    expect(estEcheanceMoisNonDu("2027-04-05", { statut: "actif", dateFin: "2027-03-15" })).toBe(false);
    expect(estEcheanceMoisNonDu("2027-04-05", { statut: "preavis", dateFin: "2027-03-15" })).toBe(false);
  });

  it("bail résilié sans date de fin (ancien cas) : rien n'est déclaré non dû", () => {
    expect(estEcheanceMoisNonDu("2027-04-05", { statut: "resilie", dateFin: null })).toBe(false);
  });
});

describe("garde-fous ajoutés après la revue financial-logic-reviewer", () => {
  it("un versement actif de 0,00 € suffit à conserver l'échéance (trop-perçu 0,00)", () => {
    expect(deciderEcheanceApresFin([versement("0.00")])).toEqual({ decision: "conserver", tropPercu: "0.00" });
  });

  it("un versement actif négatif est refusé (après la fin et au mois de fin)", () => {
    expect(() => deciderEcheanceApresFin([versement("-50.00")])).toThrow(/négatif/);
    expect(() =>
      recalculerEcheanceMoisFin({ statut: "partiel", versements: [versement("-50.00")] }, BAIL_550, "2027-03-15")
    ).toThrow(/négatif/);
  });

  it("un versement négatif archivé est ignoré", () => {
    expect(deciderEcheanceApresFin([versement("-50.00", true)])).toEqual({ decision: "archiver" });
  });

  it("un trop-perçu négatif est refusé dans le total", () => {
    expect(() => calculerTropPercuTotalResiliation("-1.00", [])).toThrow(/négatif/);
    expect(() => calculerTropPercuTotalResiliation(null, [{ decision: "conserver", tropPercu: "-5.00" }])).toThrow(
      /négatif/
    );
  });

  it("statut stocké « payé » mais reçu inférieur au prorata (incohérence) : rien n'est modifié, aucun trop-perçu", () => {
    expect(recalculerEcheanceMoisFin({ statut: "paye", versements: [versement("100.00")] }, BAIL_550, "2027-03-15")).toEqual({
      miseAJour: null,
      tropPercu: "0.00"
    });
  });

  it("écart d'arrondi porté sur le loyer, comme l'échéance d'entrée (800 + 50, fin le 16/09, 16/30)", () => {
    // 850 × 16/30 = 453,333… → 453,33 ; charges 50 × 16/30 = 26,666… → 26,66 ;
    // loyer = 453,33 − 26,66 = 426,67 (et non 800 × 16/30 tronqué = 426,66).
    const bail = { loyerMensuel: "800.00", provisionsCharges: "50.00", dateDebut: "2026-01-01" };
    expect(calculerEcheanceMoisFinACreer(bail, "2026-09-16")).toEqual({
      montant: "453.33",
      loyerHorsCharges: "426.67",
      charges: "26.66"
    });
  });
});

describe("calculerResteARembourser", () => {
  const remboursement = (montantRembourse: string, archive = false) => ({
    montantRembourse,
    archivedAt: archive ? "2027-05-02T09:00:00.000Z" : null
  });

  it("sans remboursement : tout le trop-perçu", () => {
    expect(calculerResteARembourser("283.88", [])).toBe("283.88");
  });

  it("déduit les remboursements actifs de ce paiement", () => {
    expect(calculerResteARembourser("550.00", [remboursement("200.00"), remboursement("100.00")])).toBe("250.00");
  });

  it("ignore les remboursements archivés", () => {
    expect(calculerResteARembourser("550.00", [remboursement("550.00", true)])).toBe("550.00");
  });

  it("jamais négatif (remboursé plus que le trop-perçu)", () => {
    expect(calculerResteARembourser("100.00", [remboursement("150.00")])).toBe("0.00");
  });

  it("refuse un trop-perçu négatif", () => {
    expect(() => calculerResteARembourser("-1.00", [])).toThrow(/négatif/);
  });
});
