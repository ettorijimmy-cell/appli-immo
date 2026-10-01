import { describe, expect, it } from "vitest";
import { calculerBilanRegularisation } from "./calculer-bilan-regularisation";

describe("calculerBilanRegularisation", () => {
  it("faveur du locataire quand les provisions dépassent les charges réelles", () => {
    expect(calculerBilanRegularisation("1200.00", "950.30")).toEqual({ solde: "249.70", sens: "faveur_locataire" });
  });

  it("faveur du propriétaire quand les charges réelles dépassent les provisions", () => {
    expect(calculerBilanRegularisation("800.00", "1050.00")).toEqual({ solde: "250.00", sens: "faveur_proprietaire" });
  });

  it("équilibre exact", () => {
    expect(calculerBilanRegularisation("600.00", "600.00")).toEqual({ solde: "0.00", sens: "equilibre" });
  });

  it("précision au centime, pas d'arrondi flottant", () => {
    expect(calculerBilanRegularisation("100.01", "100.00")).toEqual({ solde: "0.01", sens: "faveur_locataire" });
  });

  it("provisions nulles, charges réelles existantes : faveur propriétaire pour le plein montant", () => {
    expect(calculerBilanRegularisation("0.00", "300.00")).toEqual({ solde: "300.00", sens: "faveur_proprietaire" });
  });
});
