import { describe, expect, it } from "vitest";
import { calculerMontantEcheanceLoyer } from "../baux/echeances";
import { montantEnCentimes } from "../paiements/montant";
import {
  calculerDateFinEngagementCaution,
  calculerFinEngagementColocation,
  calculerPlafondCautionnement,
  dernierJourDePeriode,
  PLAFOND_CAUTIONNEMENT_MOIS
} from "./calculs-cautionnement";

describe("calculerPlafondCautionnement", () => {
  it("36 mois de loyer charges comprises, en centimes entiers", () => {
    expect(PLAFOND_CAUTIONNEMENT_MOIS).toBe(36);
    expect(calculerPlafondCautionnement(65000, 3000)).toBe(2_448_000);
    expect(calculerPlafondCautionnement(51240, 4735)).toBe(2_015_100);
    expect(calculerPlafondCautionnement(43333, 2171)).toBe(1_638_144);
  });

  it("charges nulles : 36 mois de loyer seul", () => {
    expect(calculerPlafondCautionnement(80000, 0)).toBe(2_880_000);
  });

  it("même somme mensuelle que calculerMontantEcheanceLoyer", () => {
    const mensuel = montantEnCentimes(calculerMontantEcheanceLoyer("512.40", "47.35"));
    expect(calculerPlafondCautionnement(51240, 4735)).toBe(36 * mensuel);
  });

  it("refuse des centimes négatifs ou non entiers", () => {
    expect(() => calculerPlafondCautionnement(-1, 0)).toThrow();
    expect(() => calculerPlafondCautionnement(100.5, 0)).toThrow();
    expect(() => calculerPlafondCautionnement(100, -5)).toThrow();
  });
});

describe("dernierJourDePeriode", () => {
  it("veille du même quantième", () => {
    expect(dernierJourDePeriode("2026-01-01", 12)).toBe("2026-12-31");
    expect(dernierJourDePeriode("2026-07-15", 36)).toBe("2029-07-14");
  });

  it("quantième absent du mois d'arrivée : dernier jour de ce mois", () => {
    expect(dernierJourDePeriode("2026-01-31", 1)).toBe("2026-02-28");
    expect(dernierJourDePeriode("2028-01-31", 1)).toBe("2028-02-29");
    expect(dernierJourDePeriode("2028-02-29", 36)).toBe("2031-02-28");
  });

  it("départ un 30 : dernier jour de février", () => {
    expect(dernierJourDePeriode("2026-01-30", 1)).toBe("2026-02-28");
  });

  it("refuse une durée nulle ou négative", () => {
    expect(() => dernierJourDePeriode("2026-01-01", 0)).toThrow();
    expect(() => dernierJourDePeriode("2026-01-01", -3)).toThrow();
  });

  it("refuse une date mal formée ou inexistante, jamais un résultat silencieux", () => {
    for (const date of ["", "2026-02-30", "2026-13-01", "2026-00-10", "2027-02-29", "01/12/2026"]) {
      expect(() => dernierJourDePeriode(date, 12)).toThrow(/date AAAA-MM-JJ attendue/);
      expect(() => calculerFinEngagementColocation(date)).toThrow(/date AAAA-MM-JJ attendue/);
    }
  });
});

describe("calculerDateFinEngagementCaution (bail initial + 2 renouvellements)", () => {
  it("bail vide de 3 ans (personne physique ou SCI familiale) → 9 ans", () => {
    expect(calculerDateFinEngagementCaution("2026-12-01", { typeBail: "vide", regime: "personne_physique" })).toBe(
      "2035-11-30"
    );
    expect(calculerDateFinEngagementCaution("2026-12-01", { typeBail: "vide", regime: "sci_familiale" })).toBe(
      "2035-11-30"
    );
  });

  it("bail vide de 6 ans (personne morale) → 18 ans", () => {
    expect(calculerDateFinEngagementCaution("2026-12-01", { typeBail: "vide", regime: "sci_non_familiale" })).toBe(
      "2044-11-30"
    );
  });

  it("bail meublé d'un an → 3 ans", () => {
    expect(calculerDateFinEngagementCaution("2026-09-01", { typeBail: "meuble", regime: "standard" })).toBe(
      "2029-08-31"
    );
  });

  it("bail meublé étudiant (9 mois, sans reconduction) → fin du bail initial", () => {
    expect(calculerDateFinEngagementCaution("2026-09-01", { typeBail: "meuble", regime: "etudiant" })).toBe(
      "2027-05-31"
    );
  });

  it("bail vide de 6 ans commençant un 29 février", () => {
    expect(calculerDateFinEngagementCaution("2028-02-29", { typeBail: "vide", regime: "sci_non_familiale" })).toBe(
      "2046-02-28"
    );
  });

  it("date d'effet un 29 février", () => {
    expect(calculerDateFinEngagementCaution("2028-02-29", { typeBail: "meuble", regime: "standard" })).toBe(
      "2031-02-28"
    );
    expect(calculerDateFinEngagementCaution("2028-02-29", { typeBail: "vide", regime: "personne_physique" })).toBe(
      "2037-02-28"
    );
  });

  it("date d'effet un 31", () => {
    expect(calculerDateFinEngagementCaution("2026-08-31", { typeBail: "vide", regime: "personne_physique" })).toBe(
      "2035-08-30"
    );
    expect(calculerDateFinEngagementCaution("2026-12-31", { typeBail: "meuble", regime: "standard" })).toBe(
      "2029-12-30"
    );
  });
});

describe("calculerFinEngagementColocation (art. 8-1, VI)", () => {
  it("si remplacé : date d'effet du congé ; au plus tard : + 6 mois", () => {
    expect(calculerFinEngagementColocation("2027-03-15")).toEqual({
      siRemplace: "2027-03-15",
      auPlusTard: "2027-09-15"
    });
  });

  it("quantième absent du mois d'arrivée : dernier jour de ce mois", () => {
    expect(calculerFinEngagementColocation("2027-08-31").auPlusTard).toBe("2028-02-29");
    expect(calculerFinEngagementColocation("2026-08-31").auPlusTard).toBe("2027-02-28");
    expect(calculerFinEngagementColocation("2026-12-31").auPlusTard).toBe("2027-06-30");
  });

  it("passage d'année", () => {
    expect(calculerFinEngagementColocation("2026-10-01").auPlusTard).toBe("2027-04-01");
  });
});
