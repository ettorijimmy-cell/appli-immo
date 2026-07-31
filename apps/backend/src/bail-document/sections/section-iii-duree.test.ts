import { describe, expect, it } from "vitest";
import { construireSectionIII } from "./section-iii-duree";

describe("construireSectionIII", () => {
  it("SCI familiale (vide) : trois ans", () => {
    const contenu = JSON.stringify(
      construireSectionIII({
        dateDebut: "2026-09-01",
        choixDuree: { typeBail: "vide", regime: "sci_familiale" }
      })
    );
    expect(contenu).toContain("2026-09-01");
    expect(contenu).toContain("trois ans");
  });

  it("SCI non familiale (vide) : six ans", () => {
    const contenu = JSON.stringify(
      construireSectionIII({
        dateDebut: "2026-09-01",
        choixDuree: { typeBail: "vide", regime: "sci_non_familiale" }
      })
    );
    expect(contenu).toContain("six ans");
  });

  it("meublé étudiant : neuf mois", () => {
    const contenu = JSON.stringify(
      construireSectionIII({
        dateDebut: "2026-09-01",
        choixDuree: { typeBail: "meuble", regime: "etudiant" }
      })
    );
    expect(contenu).toContain("neuf mois");
  });
});
