import { describe, expect, it } from "vitest";
import { construireSectionVIII } from "./section-viii-clause-resolutoire";

describe("construireSectionVIII", () => {
  it("avant le 1er octobre 2026 : texte facultatif, délai d'un mois", () => {
    const contenu = JSON.stringify(
      construireSectionVIII({ dateReference: "2026-07-01", servitudeResidencePrincipale: false })
    );
    expect(contenu).toContain("un mois");
    expect(contenu).not.toContain("six semaines");
  });

  it("à partir du 1er octobre 2026 : texte obligatoire, délai de six semaines", () => {
    const contenu = JSON.stringify(
      construireSectionVIII({ dateReference: "2026-10-01", servitudeResidencePrincipale: false })
    );
    expect(contenu).toContain("six semaines");
  });

  it("mentionne la servitude de résidence principale uniquement si applicable", () => {
    const contenu = JSON.stringify(
      construireSectionVIII({ dateReference: "2027-01-01", servitudeResidencePrincipale: true })
    );
    expect(contenu).toContain("résidence principale");
  });

  it("ne mentionne jamais de pénalité/amende", () => {
    const contenu = JSON.stringify(
      construireSectionVIII({ dateReference: "2027-01-01", servitudeResidencePrincipale: true })
    ).toLowerCase();
    expect(contenu).not.toContain("pénal");
    expect(contenu).not.toContain("amende");
  });
});
