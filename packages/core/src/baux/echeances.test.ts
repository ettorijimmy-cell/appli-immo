import { describe, expect, it } from "vitest";
import {
  calculerBornesMoisCalendaire,
  calculerDateEcheanceRecurrente,
  calculerDernierJourDuMois,
  calculerMontantEcheanceEntree,
  calculerMontantEcheanceLoyer,
  calculerProrataOccupationPartielle
} from "./echeances";

describe("calculerMontantEcheanceLoyer", () => {
  it("additionne loyer et provisions pour charges", () => {
    expect(calculerMontantEcheanceLoyer("800.00", "50.00")).toBe("850.00");
  });

  it("traite l'absence de provisions comme 0", () => {
    expect(calculerMontantEcheanceLoyer("800.00", null)).toBe("800.00");
  });

  it("tolère la virgule décimale (saisie manuelle)", () => {
    expect(calculerMontantEcheanceLoyer("800,00", "50,00")).toBe("850.00");
  });
});

describe("calculerProrataOccupationPartielle", () => {
  it("proratise sur un mois de 30 jours, départ à mi-mois", () => {
    // 900.00 / 30 jours * 15 jours occupés = 450.00
    expect(calculerProrataOccupationPartielle("900.00", "2026-09-15")).toBe("450.00");
  });

  it("facture le jour du départ en entier (inclusif)", () => {
    // 1 jour occupé sur un mois de 31 jours
    expect(calculerProrataOccupationPartielle("310.00", "2026-08-01")).toBe("10.00");
  });

  it("facture le mois complet si le départ est le dernier jour du mois", () => {
    expect(calculerProrataOccupationPartielle("900.00", "2026-09-30")).toBe("900.00");
  });

  it("tient compte des années bissextiles (février à 29 jours)", () => {
    // 2028 est bissextile : 29 jours en février
    expect(calculerProrataOccupationPartielle("290.00", "2028-02-29")).toBe("290.00");
    expect(calculerProrataOccupationPartielle("290.00", "2028-02-01")).toBe("10.00");
  });

  it("tronque au-delà de deux décimales sans arrondir de travers", () => {
    // juin = 30 jours : 1000.00 / 30 * 1 jour = 33.333... -> tronqué à 33.33
    expect(calculerProrataOccupationPartielle("1000.00", "2026-06-01")).toBe("33.33");
  });

  describe("avec dateDebutOccupation (début de mois partiel)", () => {
    it("proratise depuis le début d'occupation quand il tombe dans le même mois que dateFin", () => {
      // juillet = 31 jours : occupation du 10 au 20 inclus = 11 jours
      // 930.00 / 31 * 11 jours = 330.00 exactement
      expect(calculerProrataOccupationPartielle("930.00", "2026-07-20", "2026-07-10")).toBe("330.00");
    });

    it("traite un début d'occupation dans un mois antérieur comme le 1er du mois de dateFin (comportement identique à l'appel à 2 arguments)", () => {
      expect(calculerProrataOccupationPartielle("930.00", "2026-07-20", "2026-06-15")).toBe(
        calculerProrataOccupationPartielle("930.00", "2026-07-20")
      );
    });

    it("ramène à 0 si le début d'occupation calculé est postérieur à dateFin dans le même mois", () => {
      expect(calculerProrataOccupationPartielle("930.00", "2026-07-10", "2026-07-20")).toBe("0.00");
    });

    it("facture le jour de début d'occupation en entier (inclusif)", () => {
      // même jour de début et de fin -> 1 seul jour occupé
      expect(calculerProrataOccupationPartielle("310.00", "2026-08-15", "2026-08-15")).toBe("10.00");
    });
  });
});

describe("calculerDernierJourDuMois", () => {
  it("retourne le dernier jour d'un mois de 31 jours", () => {
    expect(calculerDernierJourDuMois("2026-07-15")).toBe("2026-07-31");
  });

  it("retourne le dernier jour d'un mois de 30 jours", () => {
    expect(calculerDernierJourDuMois("2026-09-01")).toBe("2026-09-30");
  });

  it("tient compte des années bissextiles pour février", () => {
    expect(calculerDernierJourDuMois("2028-02-05")).toBe("2028-02-29");
    expect(calculerDernierJourDuMois("2026-02-05")).toBe("2026-02-28");
  });

  it("fonctionne quand la date fournie est déjà le dernier jour du mois", () => {
    expect(calculerDernierJourDuMois("2026-04-30")).toBe("2026-04-30");
  });
});

describe("calculerMontantEcheanceEntree", () => {
  it("facture le mois entier si date_debut tombe le 1er du mois", () => {
    expect(calculerMontantEcheanceEntree("930.00", null, "2026-07-01")).toBe("930.00");
  });

  it("proratise du jour de date_debut jusqu'à la fin du mois calendaire", () => {
    // juillet = 31 jours, occupation du 20 au 31 inclus = 12 jours
    // 930.00 / 31 * 12 jours = 360.00 exactement
    expect(calculerMontantEcheanceEntree("930.00", null, "2026-07-20")).toBe("360.00");
  });

  it("inclut les provisions pour charges dans le montant proratisé", () => {
    // 980.00 (930 loyer + 50 charges) / 31 * 12 jours = 379.35 (tronqué)
    expect(calculerMontantEcheanceEntree("930.00", "50.00", "2026-07-20")).toBe("379.35");
  });
});

describe("calculerBornesMoisCalendaire", () => {
  it("retourne le premier jour du mois et le premier jour du mois suivant", () => {
    expect(calculerBornesMoisCalendaire("2026-09-15")).toEqual({
      debutMoisInclus: "2026-09-01",
      debutMoisSuivantExclusif: "2026-10-01"
    });
  });

  it("passe correctement de décembre à janvier de l'année suivante", () => {
    expect(calculerBornesMoisCalendaire("2026-12-25")).toEqual({
      debutMoisInclus: "2026-12-01",
      debutMoisSuivantExclusif: "2027-01-01"
    });
  });
});

describe("calculerDateEcheanceRecurrente", () => {
  it("construit la date d'échéance du mois de dateReference avec jourEcheance", () => {
    expect(calculerDateEcheanceRecurrente("2026-07-20", 5)).toBe("2026-07-05");
  });

  it("fonctionne avec un jourEcheance à un seul chiffre (jamais sauté)", () => {
    expect(calculerDateEcheanceRecurrente("2026-01-15", 1)).toBe("2026-01-01");
  });

  it("fonctionne avec jourEcheance en fin de plage autorisée (28)", () => {
    expect(calculerDateEcheanceRecurrente("2026-02-10", 28)).toBe("2026-02-28");
  });

  it("reste dans le mois de dateReference même en passage décembre-janvier", () => {
    expect(calculerDateEcheanceRecurrente("2026-12-31", 5)).toBe("2026-12-05");
    expect(calculerDateEcheanceRecurrente("2027-01-01", 5)).toBe("2027-01-05");
  });

  it("ne dépend jamais du jour de dateReference (déjà dépassé ou non dans le mois)", () => {
    // Le mois courant n'est jamais sauté même si jourEcheance y est déjà
    // dépassé (docs/data-dictionary.md, section baux) : la fonction ne
    // regarde que l'année/mois de dateReference, jamais son jour.
    expect(calculerDateEcheanceRecurrente("2026-07-01", 20)).toBe("2026-07-20");
    expect(calculerDateEcheanceRecurrente("2026-07-31", 20)).toBe("2026-07-20");
  });
});
