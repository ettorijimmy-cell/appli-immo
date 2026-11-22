import { describe, expect, it } from "vitest";
import { PLAFOND_MONTANT_SAISI_CENTIMES, verifierMontantSaisi } from "./verifier-montant-saisi";

// Bornes des montants saisis (petites suites, décision 3 de Jimmy du
// 2026-11-22) : « > 0 » ou « >= 0 » selon le champ, deux décimales au plus,
// plafond de la colonne decimal(10,2).
describe("verifierMontantSaisi", () => {
  describe("strictement positif (> 0)", () => {
    const regle = { zeroAutorise: false } as const;

    it.each(["0.01", "1", "12.5", "1250.50", "12,50", " 1 250,50 ", "99999999.99"])("accepte « %s »", (saisie) => {
      expect(verifierMontantSaisi(saisie, regle)).toBeNull();
    });

    it.each(["0", "0.00", "0,00", "00"])("refuse « %s » (zéro)", (saisie) => {
      expect(verifierMontantSaisi(saisie, regle)).toBe("nul");
    });

    it.each(["-5", "-0.01", "-0", "-0.00", "-1250,50"])("refuse « %s » (négatif)", (saisie) => {
      expect(verifierMontantSaisi(saisie, regle)).toBe("negatif");
    });
  });

  describe("positif ou nul (>= 0)", () => {
    const regle = { zeroAutorise: true } as const;

    it.each(["0", "0.00", "0,00", "0.01", "750"])("accepte « %s »", (saisie) => {
      expect(verifierMontantSaisi(saisie, regle)).toBeNull();
    });

    it.each(["-0.01", "-5", "-0"])("refuse « %s » (négatif)", (saisie) => {
      expect(verifierMontantSaisi(saisie, regle)).toBe("negatif");
    });
  });

  describe("format (les deux règles)", () => {
    it.each(["", " ", "abc", "+5", "1e3", "1.234", "12,505", "1.", ".5", "1..2", "Infinity", "NaN", "1 2a", "--5", "5-"])(
      "refuse « %s »",
      (saisie) => {
        expect(verifierMontantSaisi(saisie, { zeroAutorise: true })).toBe("format");
        expect(verifierMontantSaisi(saisie, { zeroAutorise: false })).toBe("format");
      }
    );
  });

  describe("plafond", () => {
    it("par défaut, celui d'une colonne decimal(10,2) : 99 999 999,99 €", () => {
      expect(PLAFOND_MONTANT_SAISI_CENTIMES).toBe(9_999_999_999);
      expect(verifierMontantSaisi("99999999.99", { zeroAutorise: false })).toBeNull();
      expect(verifierMontantSaisi("100000000", { zeroAutorise: false })).toBe("trop_grand");
      expect(verifierMontantSaisi("100000000.00", { zeroAutorise: true })).toBe("trop_grand");
      expect(verifierMontantSaisi("123456789012345678901234567890", { zeroAutorise: true })).toBe("trop_grand");
    });

    it("un plafond propre au champ (ex. decimal(12,2))", () => {
      const regle = { zeroAutorise: true, plafondCentimes: 999_999_999_999 } as const;
      expect(verifierMontantSaisi("100000000", regle)).toBeNull();
      expect(verifierMontantSaisi("9999999999.99", regle)).toBeNull();
      expect(verifierMontantSaisi("10000000000", regle)).toBe("trop_grand");
    });
  });
});
