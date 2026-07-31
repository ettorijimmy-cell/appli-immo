import { describe, expect, it } from "vitest";
import { construireSectionIV } from "./section-iv-conditions-financieres";

describe("construireSectionIV", () => {
  it("loyer et provisions toujours présents", () => {
    const contenu = JSON.stringify(
      construireSectionIV({
        loyerMensuel: "800.00",
        provisionsCharges: "100.00",
        loyerPrecedentLocataire: null,
        depensesTheoriquesChauffage: null
      })
    );
    expect(contenu).toContain("800.00");
    expect(contenu).toContain("100.00");
  });

  it("mentionne le loyer précédent locataire seulement si fourni", () => {
    const sansLoyerPrecedent = JSON.stringify(
      construireSectionIV({
        loyerMensuel: "800.00",
        provisionsCharges: null,
        loyerPrecedentLocataire: null,
        depensesTheoriquesChauffage: null
      })
    );
    expect(sansLoyerPrecedent).not.toContain("précédent locataire");

    const avecLoyerPrecedent = JSON.stringify(
      construireSectionIV({
        loyerMensuel: "800.00",
        provisionsCharges: null,
        loyerPrecedentLocataire: "750.00",
        depensesTheoriquesChauffage: null
      })
    );
    expect(avecLoyerPrecedent).toContain("précédent locataire");
    expect(avecLoyerPrecedent).toContain("750.00");
  });

  it("mentionne les dépenses théoriques de chauffage seulement si fournies", () => {
    const contenu = JSON.stringify(
      construireSectionIV({
        loyerMensuel: "800.00",
        provisionsCharges: null,
        loyerPrecedentLocataire: null,
        depensesTheoriquesChauffage: "450.00"
      })
    );
    expect(contenu).toContain("450.00");
    expect(contenu).toContain("chauffage");
  });
});
