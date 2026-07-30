import { describe, expect, it } from "vitest";
import { calculerMontantRecuTotal } from "./calculer-montant-recu-total";

describe("calculerMontantRecuTotal", () => {
  it("retourne 0.00 pour un tableau vide", () => {
    expect(calculerMontantRecuTotal([])).toBe("0.00");
  });

  it("retourne le montant d'un seul versement actif", () => {
    expect(calculerMontantRecuTotal([{ montant: "400.00", archivedAt: null }])).toBe("400.00");
  });

  it("additionne plusieurs versements actifs, y compris le même jour", () => {
    const versements = [
      { montant: "400.00", archivedAt: null },
      { montant: "400.00", archivedAt: null }
    ];
    expect(calculerMontantRecuTotal(versements)).toBe("800.00");
  });

  it("exclut un versement archivé (annulé)", () => {
    const versements = [
      { montant: "400.00", archivedAt: null },
      { montant: "400.00", archivedAt: new Date("2026-07-01") }
    ];
    expect(calculerMontantRecuTotal(versements)).toBe("400.00");
  });

  it("retourne 0.00 si tous les versements sont archivés", () => {
    const versements = [
      { montant: "400.00", archivedAt: new Date("2026-07-01") },
      { montant: "200.00", archivedAt: new Date("2026-07-02") }
    ];
    expect(calculerMontantRecuTotal(versements)).toBe("0.00");
  });

  it("gère un dépassement (trop-perçu) sans arrondi flottant", () => {
    const versements = [
      { montant: "0.10", archivedAt: null },
      { montant: "0.10", archivedAt: null },
      { montant: "0.10", archivedAt: null }
    ];
    expect(calculerMontantRecuTotal(versements)).toBe("0.30");
  });
});
