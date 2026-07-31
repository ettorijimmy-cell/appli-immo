import { describe, expect, it } from "vitest";
import { construireSectionXI } from "./section-xi-annexes";

describe("construireSectionXI", () => {
  it("liste chaque diagnostic joint avec sa date de validité", () => {
    const contenu = JSON.stringify(
      construireSectionXI({
        typeBail: "vide",
        diagnostics: [
          { categorie: "dpe", present: true, dateExpiration: "2036-01-01" },
          { categorie: "crep_plomb", present: false, dateExpiration: null }
        ],
        attestationAssurancePresente: true,
        etatDesLieuxEntreePresent: true
      })
    );

    expect(contenu).toContain("Diagnostic de performance énergétique");
    expect(contenu).toContain("2036-01-01");
    expect(contenu).toContain("Constat de risque d'exposition au plomb");
    expect(contenu).toContain("absent");
    expect(contenu).toContain("Attestation d'assurance");
    expect(contenu).toContain("jointe");
    expect(contenu).toContain("État des lieux d'entrée");
  });

  it("mentionne l'inventaire de mobilier uniquement pour un bail meublé", () => {
    const donneesCommunes = {
      diagnostics: [],
      attestationAssurancePresente: false,
      etatDesLieuxEntreePresent: false
    };

    const vide = JSON.stringify(construireSectionXI({ typeBail: "vide", ...donneesCommunes }));
    expect(vide).not.toContain("inventaire de mobilier");

    const meuble = JSON.stringify(construireSectionXI({ typeBail: "meuble", ...donneesCommunes }));
    expect(meuble).toContain("inventaire de mobilier");
  });

  it("signale explicitement les documents manquants, jamais un vide silencieux", () => {
    const contenu = JSON.stringify(
      construireSectionXI({
        typeBail: "vide",
        diagnostics: [],
        attestationAssurancePresente: false,
        etatDesLieuxEntreePresent: false
      })
    );
    expect(contenu.match(/à joindre avant signature/g)?.length).toBe(2);
  });
});
