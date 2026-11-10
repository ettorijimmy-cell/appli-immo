import { describe, expect, it } from "vitest";
import { categoriesProposees } from "./categories-proposees";
import { CATEGORIE_LABELS } from "./labels";

describe("catégories proposées au dépôt d'un document", () => {
  it("garant : pièce d'identité, contrat Visale et acte signé en premier, sans doublon", () => {
    const categories = categoriesProposees("garant");
    expect(categories.slice(0, 3)).toEqual(["piece_identite", "contrat_cautionnement_visale", "acte_cautionnement_signe"]);
    expect(new Set(categories).size).toBe(categories.length);
    expect(categories).toContain("courrier");
  });

  it("autres entités : liste inchangée, sans les catégories propres au garant", () => {
    const categories = categoriesProposees("locataire");
    expect(categories[0]).toBe("bail");
    expect(categories).not.toContain("contrat_cautionnement_visale");
    expect(categories).not.toContain("acte_cautionnement_signe");
  });

  it("libellés lisibles des deux nouvelles catégories", () => {
    expect(CATEGORIE_LABELS.contrat_cautionnement_visale).toBe("Contrat de cautionnement Visale");
    expect(CATEGORIE_LABELS.acte_cautionnement_signe).toBe("Acte de cautionnement signé");
  });
});
