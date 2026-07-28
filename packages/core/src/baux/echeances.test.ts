import { describe, expect, it } from "vitest";
import {
  calculerBornesMoisCalendaire,
  calculerDatePremiereEcheance,
  calculerMontantEcheanceLoyer,
  calculerProrataResiliation
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

describe("calculerDatePremiereEcheance", () => {
  it("prend le mois en cours si le jour d'activation précède jour_echeance", () => {
    expect(calculerDatePremiereEcheance("2026-08-05", 15)).toBe("2026-08-15");
  });

  it("prend le mois en cours si le jour d'activation est égal à jour_echeance (égalité = pas encore passé)", () => {
    expect(calculerDatePremiereEcheance("2026-08-15", 15)).toBe("2026-08-15");
  });

  it("prend le mois suivant si le jour d'activation dépasse jour_echeance", () => {
    expect(calculerDatePremiereEcheance("2026-08-20", 15)).toBe("2026-09-15");
  });

  it("passe correctement de décembre à janvier de l'année suivante", () => {
    expect(calculerDatePremiereEcheance("2026-12-20", 5)).toBe("2027-01-05");
  });

  it("gère jour_echeance = 28 (borne haute)", () => {
    expect(calculerDatePremiereEcheance("2026-02-28", 28)).toBe("2026-02-28");
    expect(calculerDatePremiereEcheance("2026-03-01", 28)).toBe("2026-03-28");
  });
});

describe("calculerProrataResiliation", () => {
  it("proratise sur un mois de 30 jours, départ à mi-mois", () => {
    // 900.00 / 30 jours * 15 jours occupés = 450.00
    expect(calculerProrataResiliation("900.00", "2026-09-15")).toBe("450.00");
  });

  it("facture le jour du départ en entier (inclusif)", () => {
    // 1 jour occupé sur un mois de 31 jours
    expect(calculerProrataResiliation("310.00", "2026-08-01")).toBe("10.00");
  });

  it("facture le mois complet si le départ est le dernier jour du mois", () => {
    expect(calculerProrataResiliation("900.00", "2026-09-30")).toBe("900.00");
  });

  it("tient compte des années bissextiles (février à 29 jours)", () => {
    // 2028 est bissextile : 29 jours en février
    expect(calculerProrataResiliation("290.00", "2028-02-29")).toBe("290.00");
    expect(calculerProrataResiliation("290.00", "2028-02-01")).toBe("10.00");
  });

  it("tronque au-delà de deux décimales sans arrondir de travers", () => {
    // juin = 30 jours : 1000.00 / 30 * 1 jour = 33.333... -> tronqué à 33.33
    expect(calculerProrataResiliation("1000.00", "2026-06-01")).toBe("33.33");
  });

  describe("avec dateDebutOccupation (Cas B — aucune échéance pré-générée)", () => {
    it("proratise depuis le début d'occupation quand il tombe dans le même mois que dateFin", () => {
      // juillet = 31 jours : occupation du 10 au 20 inclus = 11 jours
      // 930.00 / 31 * 11 jours = 330.00 exactement
      expect(calculerProrataResiliation("930.00", "2026-07-20", "2026-07-10")).toBe("330.00");
    });

    it("traite un début d'occupation dans un mois antérieur comme le 1er du mois de dateFin (comportement identique à l'appel à 2 arguments)", () => {
      expect(calculerProrataResiliation("930.00", "2026-07-20", "2026-06-15")).toBe(
        calculerProrataResiliation("930.00", "2026-07-20")
      );
    });

    it("ramène à 0 si le début d'occupation calculé est postérieur à dateFin dans le même mois", () => {
      expect(calculerProrataResiliation("930.00", "2026-07-10", "2026-07-20")).toBe("0.00");
    });

    it("facture le jour de début d'occupation en entier (inclusif)", () => {
      // même jour de début et de fin -> 1 seul jour occupé
      expect(calculerProrataResiliation("310.00", "2026-08-15", "2026-08-15")).toBe("10.00");
    });
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
