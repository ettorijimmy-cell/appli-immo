import { describe, expect, it } from "vitest";
import { construireSectionX } from "./section-x-conditions-particulieres";

describe("construireSectionX", () => {
  it("affiche néant si aucune condition particulière", () => {
    const contenu = JSON.stringify(construireSectionX({ conditionsParticulieres: null }));
    expect(contenu).toContain("Néant");
  });

  it("affiche le texte libre s'il est renseigné", () => {
    const contenu = JSON.stringify(
      construireSectionX({ conditionsParticulieres: "Autorisation de détenir un animal domestique." })
    );
    expect(contenu).toContain("animal domestique");
  });
});
