import { describe, expect, it } from "vitest";
import { formaterFourchetteDepensesEnergie } from "./formater-fourchette-depenses-energie";

describe("formaterFourchetteDepensesEnergie", () => {
  it("affiche un montant unique quand min et max sont égaux", () => {
    expect(formaterFourchetteDepensesEnergie("150.00", "150.00")).toBe("150.00");
  });

  it("affiche une fourchette quand min et max diffèrent", () => {
    expect(formaterFourchetteDepensesEnergie("150.00", "200.00")).toBe("entre 150.00 et 200.00");
  });

  it("renvoie null si min est absent", () => {
    expect(formaterFourchetteDepensesEnergie(null, "200.00")).toBeNull();
  });

  it("renvoie null si max est absent", () => {
    expect(formaterFourchetteDepensesEnergie("150.00", undefined)).toBeNull();
  });

  it("renvoie null si les deux sont absents", () => {
    expect(formaterFourchetteDepensesEnergie(null, null)).toBeNull();
  });
});
