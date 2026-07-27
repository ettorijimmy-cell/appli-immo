import { describe, expect, it } from "vitest";
import { montantEnCentimes, normaliserMontant } from "./montant";

describe("normaliserMontant", () => {
  it("laisse un montant à point décimal inchangé", () => {
    expect(normaliserMontant("850.00")).toBe("850.00");
  });

  it("convertit la virgule décimale en point", () => {
    expect(normaliserMontant("850,00")).toBe("850.00");
  });

  it("retire les espaces (séparateurs de milliers)", () => {
    expect(normaliserMontant("1 850,00")).toBe("1850.00");
  });

  it("retire les espaces en début/fin", () => {
    expect(normaliserMontant("  850.00  ")).toBe("850.00");
  });
});

describe("montantEnCentimes", () => {
  it("convertit un montant avec point décimal", () => {
    expect(montantEnCentimes("850.00")).toBe(85000);
  });

  it("convertit un montant avec virgule décimale (relevé bancaire français)", () => {
    expect(montantEnCentimes("850,00")).toBe(85000);
  });

  it("convertit un montant sans décimale", () => {
    expect(montantEnCentimes("850")).toBe(85000);
  });

  it("convertit un montant avec un seul chiffre décimal", () => {
    expect(montantEnCentimes("850.5")).toBe(85050);
  });

  it("ignore les espaces (séparateurs de milliers)", () => {
    expect(montantEnCentimes("1 850.00")).toBe(185000);
  });

  it("gère les montants négatifs", () => {
    expect(montantEnCentimes("-850.00")).toBe(-85000);
  });

  it("tronque au-delà de deux décimales sans arrondir de travers", () => {
    expect(montantEnCentimes("850.999")).toBe(85099);
  });

  it("rejette un montant non numérique", () => {
    expect(() => montantEnCentimes("abc")).toThrow(/invalide/i);
  });

  it("ne produit jamais d'imprécision flottante sur des cas connus pour piéger parseFloat", () => {
    // 0.1 + 0.2 !== 0.3 en float — vérifie que la conversion textuelle
    // n'est pas affectée par ce type d'imprécision.
    expect(montantEnCentimes("0.10")).toBe(10);
    expect(montantEnCentimes("0.20")).toBe(20);
    expect(montantEnCentimes("1000000.29")).toBe(100000029);
  });
});
