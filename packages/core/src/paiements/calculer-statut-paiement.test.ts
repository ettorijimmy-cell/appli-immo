import { describe, expect, it } from "vitest";
import { calculerStatutPaiement } from "./calculer-statut-paiement";

describe("calculerStatutPaiement", () => {
  it("impaye si aucun montant n'a été reçu", () => {
    expect(calculerStatutPaiement("850.00", null)).toBe("impaye");
  });

  it("impaye si le montant reçu est zéro", () => {
    expect(calculerStatutPaiement("850.00", "0.00")).toBe("impaye");
  });

  it("paye si le montant reçu correspond exactement", () => {
    expect(calculerStatutPaiement("850.00", "850.00")).toBe("paye");
  });

  it("paye si le montant reçu dépasse le montant attendu (trop-perçu)", () => {
    expect(calculerStatutPaiement("850.00", "900.00")).toBe("paye");
  });

  it("partiel si le montant reçu est inférieur au montant attendu", () => {
    expect(calculerStatutPaiement("850.00", "400.00")).toBe("partiel");
  });

  it("ne se laisse pas piéger par une imprécision flottante sur des montants proches", () => {
    // 850.10 - 0.01 ne doit jamais être confondu avec 850.10 en centimes.
    expect(calculerStatutPaiement("850.10", "850.09")).toBe("partiel");
    expect(calculerStatutPaiement("850.10", "850.10")).toBe("paye");
  });
});
