import { describe, expect, it } from "vitest";
import { construireSectionVI } from "./section-vi-garanties";

describe("construireSectionVI", () => {
  it("affiche le montant du dépôt de garantie s'il est renseigné", () => {
    const contenu = JSON.stringify(construireSectionVI({ depotGarantie: "800.00" }));
    expect(contenu).toContain("800.00");
  });

  it("indique l'absence de dépôt de garantie sinon", () => {
    const contenu = JSON.stringify(construireSectionVI({ depotGarantie: null }));
    expect(contenu).toContain("Aucun dépôt de garantie");
  });
});
