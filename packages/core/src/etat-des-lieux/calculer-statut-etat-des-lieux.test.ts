import { describe, expect, it } from "vitest";
import { calculerStatutEtatDesLieux } from "./calculer-statut-etat-des-lieux";

describe("calculerStatutEtatDesLieux", () => {
  it("non_commence si aucune date d'entrée", () => {
    expect(calculerStatutEtatDesLieux(null, null)).toBe("non_commence");
  });

  it("entree_terminee si la date d'entrée est renseignée mais pas la sortie", () => {
    expect(calculerStatutEtatDesLieux("2026-08-03", null)).toBe("entree_terminee");
  });

  it("complet si les deux dates sont renseignées", () => {
    expect(calculerStatutEtatDesLieux("2026-08-03", "2028-08-03")).toBe("complet");
  });
});
