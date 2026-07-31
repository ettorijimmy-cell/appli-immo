import { describe, expect, it } from "vitest";
import { construireSectionIX } from "./section-ix-honoraires";

describe("construireSectionIX", () => {
  it("affiche néant tant qu'aucun honoraire n'est renseigné", () => {
    const contenu = JSON.stringify(
      construireSectionIX({ honorairesBailleur: null, honorairesLocataire: null })
    );
    expect(contenu).toContain("Néant");
  });

  it("affiche la répartition dès qu'un des deux montants est renseigné", () => {
    const contenu = JSON.stringify(
      construireSectionIX({ honorairesBailleur: "150.00", honorairesLocataire: "150.00" })
    );
    expect(contenu).toContain("bailleur");
    expect(contenu).toContain("locataire");
    expect(contenu.match(/150\.00/g)?.length).toBe(2);
  });
});
