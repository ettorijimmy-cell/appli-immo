import { describe, expect, it } from "vitest";
import { calculerTauxEffort } from "./calculer-taux-effort";

describe("calculerTauxEffort", () => {
  it("calcule le taux d'effort en centimes entiers", () => {
    // 500 / 1500 * 100 = 33,3333...% -> 3333 centimes
    expect(calculerTauxEffort("500", "1500")).toBe(3333);
  });

  it("calcule un taux exact sans reste", () => {
    // 300 / 1000 * 100 = 30% -> 3000 centimes
    expect(calculerTauxEffort("300", "1000")).toBe(3000);
  });

  it("retourne null si revenuMensuelNet est absent", () => {
    expect(calculerTauxEffort("500", null)).toBeNull();
  });

  it("retourne null si loyerVise est absent", () => {
    expect(calculerTauxEffort(null, "1500")).toBeNull();
  });

  it("retourne null si revenuMensuelNet est nul, sans jamais diviser par zéro", () => {
    expect(calculerTauxEffort("500", "0")).toBeNull();
  });

  it("gère les montants avec virgule décimale", () => {
    // 450,50 / 1200 * 100 ≈ 37,5416...% -> 3754 centimes
    expect(calculerTauxEffort("450,50", "1200")).toBe(3754);
  });
});
