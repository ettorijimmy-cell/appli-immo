import { describe, expect, it } from "vitest";
import { construireSectionVII } from "./section-vii-solidarite";

describe("construireSectionVII", () => {
  it("sans objet pour un seul locataire — pas de mention d'extinction à 6 mois", () => {
    const contenu = JSON.stringify(construireSectionVII({ nombreLocataires: 1 }));
    expect(contenu).toContain("Sans objet");
    expect(contenu).not.toContain("six mois");
  });

  it("clause de solidarité et règle d'extinction à 6 mois présentes en cas de colocation", () => {
    const contenu = JSON.stringify(construireSectionVII({ nombreLocataires: 2 }));
    expect(contenu).toContain("solidairement");
    expect(contenu).toContain("six mois");
    expect(contenu).toContain("article 8-1");
  });
});
