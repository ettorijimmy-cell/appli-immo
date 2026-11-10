import { describe, expect, it } from "vitest";
import { formaterMontantChiffres } from "./formater-montant";

describe("formaterMontantChiffres", () => {
  it("deux décimales après une virgule", () => {
    expect(formaterMontantChiffres(0)).toBe("0,00");
    expect(formaterMontantChiffres(5)).toBe("0,05");
    expect(formaterMontantChiffres(65000)).toBe("650,00");
    expect(formaterMontantChiffres(65050)).toBe("650,50");
  });

  it("milliers séparés par une espace insécable", () => {
    expect(formaterMontantChiffres(2340000)).toBe("23 400,00");
    expect(formaterMontantChiffres(123456789)).toBe("1 234 567,89");
  });

  it("refuse un montant négatif ou non entier", () => {
    expect(() => formaterMontantChiffres(-1)).toThrow("Montant en centimes invalide : -1");
    expect(() => formaterMontantChiffres(1.5)).toThrow("Montant en centimes invalide : 1.5");
  });
});
