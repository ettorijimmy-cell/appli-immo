import { describe, expect, it } from "vitest";
import { centimesVersMontant, montantEnCentimes } from "../paiements/montant";
import {
  calculerBornesMoisCalendaire,
  calculerDateEcheanceRecurrente,
  calculerDecompositionEcheanceEntree,
  calculerDecompositionEcheanceFin,
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

describe("calculerDecompositionEcheanceEntree", () => {
  it("facture le mois entier si date_debut tombe le 1er du mois", () => {
    expect(calculerDecompositionEcheanceEntree("930.00", "50.00", "2026-07-01")).toEqual({
      montant: "980.00",
      loyerHorsCharges: "930.00",
      charges: "50.00"
    });
  });

  it("proratise loyer et charges de façon cohérente quand la division tombe juste", () => {
    // juillet = 31 jours, occupation du 20 au 31 inclus = 12 jours ; 930 * 12 / 31 = 360.00 exactement
    expect(calculerDecompositionEcheanceEntree("930.00", "50.00", "2026-07-20")).toEqual({
      montant: "379.35",
      loyerHorsCharges: "360.00",
      charges: "19.35"
    });
  });

  it("absorbe l'écart d'arrondi sur loyerHorsCharges quand les troncatures indépendantes divergeraient", () => {
    // septembre = 30 jours, occupation du 15 au 30 inclus = 16 jours.
    // montant (troncature de la SOMME) : 850.00 * 16 / 30 = 453.333... -> 453.33
    // charges (proratisé normalement) : 50.00 * 16 / 30 = 26.666... -> 26.66
    // loyer proratisé INDÉPENDAMMENT aurait donné 800.00 * 16 / 30 = 426.666... -> 426.66,
    // soit 426.66 + 26.66 = 453.32 (un centime de moins que montant) : c'est
    // précisément l'écart que la dérivation par soustraction élimine.
    expect(calculerDecompositionEcheanceEntree("800.00", "50.00", "2026-09-15")).toEqual({
      montant: "453.33",
      loyerHorsCharges: "426.67",
      charges: "26.66"
    });
  });

  it("traite l'absence de provisions pour charges comme 0.00, jamais null", () => {
    expect(calculerDecompositionEcheanceEntree("930.00", null, "2026-07-20")).toEqual({
      montant: "360.00",
      loyerHorsCharges: "360.00",
      charges: "0.00"
    });
  });

  it("garantit toujours loyerHorsCharges + charges === montant", () => {
    const { montant, loyerHorsCharges, charges } = calculerDecompositionEcheanceEntree(
      "800.00",
      "50.00",
      "2026-09-15"
    );
    expect(centimesVersMontant(montantEnCentimes(loyerHorsCharges) + montantEnCentimes(charges))).toBe(montant);
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

describe("calculerDecompositionEcheanceFin", () => {
  // Bail de l'audit du 2026-11-14 : 550 € = 500 + 50, entré avant le mois de fin.
  const fin = (dateFin: string, dateDebut = "2026-10-01", provisions: string | null = "50.00") =>
    calculerDecompositionEcheanceFin("500.00", provisions, dateDebut, dateFin);

  it("fin le 15 d'un mois de 31 jours : 266,12 dont charges 24,19 et loyer 241,93", () => {
    expect(fin("2027-03-15")).toEqual({ montant: "266.12", loyerHorsCharges: "241.93", charges: "24.19" });
  });

  it("fin le 15 d'un mois de 30 jours : 275,00 (250 + 25)", () => {
    expect(fin("2027-04-15")).toEqual({ montant: "275.00", loyerHorsCharges: "250.00", charges: "25.00" });
  });

  it("fin le 1er : un jour facturé", () => {
    // 550 × 1/31 = 17,741… → 17,74 ; charges 50 × 1/31 = 1,612… → 1,61.
    expect(fin("2027-03-01")).toEqual({ montant: "17.74", loyerHorsCharges: "16.13", charges: "1.61" });
  });

  it("fin le dernier jour (31 ou 30) : mois plein", () => {
    expect(fin("2027-03-31")).toEqual({ montant: "550.00", loyerHorsCharges: "500.00", charges: "50.00" });
    expect(fin("2027-04-30")).toEqual({ montant: "550.00", loyerHorsCharges: "500.00", charges: "50.00" });
  });

  it("février 28 jours et 29 jours", () => {
    expect(fin("2027-02-14")).toEqual({ montant: "275.00", loyerHorsCharges: "250.00", charges: "25.00" });
    // 550 × 14/29 = 265,517… → 265,51 ; charges 50 × 14/29 = 24,137… → 24,13.
    expect(fin("2028-02-14")).toEqual({ montant: "265.51", loyerHorsCharges: "241.38", charges: "24.13" });
    expect(fin("2027-02-28")).toEqual({ montant: "550.00", loyerHorsCharges: "500.00", charges: "50.00" });
    expect(fin("2028-02-29")).toEqual({ montant: "550.00", loyerHorsCharges: "500.00", charges: "50.00" });
  });

  it("même mois que la date de début : de date_debut à date_fin incluses", () => {
    // 10 → 20 mars : 11 jours sur 31.
    expect(fin("2027-03-20", "2027-03-10")).toEqual({ montant: "195.16", loyerHorsCharges: "177.42", charges: "17.74" });
    // Entrée et sortie le même jour : un jour.
    expect(fin("2027-03-10", "2027-03-10")).toEqual({ montant: "17.74", loyerHorsCharges: "16.13", charges: "1.61" });
  });

  it("sans provisions : charges à zéro, tout en loyer", () => {
    expect(fin("2027-03-15", "2026-10-01", null)).toEqual({ montant: "241.93", loyerHorsCharges: "241.93", charges: "0.00" });
  });

  it("toujours loyerHorsCharges + charges = montant", () => {
    for (const dateFin of ["2027-01-07", "2027-02-11", "2027-06-19", "2027-07-23", "2028-02-03"]) {
      const d = fin(dateFin);
      expect(montantEnCentimes(d.loyerHorsCharges) + montantEnCentimes(d.charges)).toBe(montantEnCentimes(d.montant));
    }
  });

  it("refuse les entrées invalides", () => {
    expect(() => fin("2026-09-30")).toThrow(/précède/);
    expect(() => fin("2027-02-29")).toThrow(/invalide/);
    expect(() => fin("2027-03-15T00:00:00Z")).toThrow(/invalide/);
    expect(() => fin("2027-03-15", "2026-13-01")).toThrow(/invalide/);
    expect(() => calculerDecompositionEcheanceFin("-500.00", "50.00", "2026-10-01", "2027-03-15")).toThrow(/négatif/);
    expect(() => calculerDecompositionEcheanceFin("500.00", "-1.00", "2026-10-01", "2027-03-15")).toThrow(/négatif/);
    expect(() => calculerDecompositionEcheanceFin("abc", "50.00", "2026-10-01", "2027-03-15")).toThrow();
  });
});
