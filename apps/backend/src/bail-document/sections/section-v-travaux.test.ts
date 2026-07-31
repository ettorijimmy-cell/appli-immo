import { describe, expect, it } from "vitest";
import { construireSectionV } from "./section-v-travaux";

describe("construireSectionV", () => {
  it("affiche le texte libre s'il est renseigné", () => {
    const contenu = JSON.stringify(construireSectionV({ travauxRealises: "Réfection de la toiture en 2024" }));
    expect(contenu).toContain("Réfection de la toiture en 2024");
  });

  it("affiche néant si absent", () => {
    const contenu = JSON.stringify(construireSectionV({ travauxRealises: null }));
    expect(contenu).toContain("néant");
  });
});
