import { describe, expect, it } from "vitest";
import { calculerLibelleDepotGarantie } from "./calculer-libelle-depot-garantie";

describe("calculerLibelleDepotGarantie", () => {
  it("un mois pour un bail vide", () => {
    expect(calculerLibelleDepotGarantie("vide")).toBe("un mois");
  });

  it("deux mois pour un bail meublé", () => {
    expect(calculerLibelleDepotGarantie("meuble")).toBe("deux mois");
  });
});
