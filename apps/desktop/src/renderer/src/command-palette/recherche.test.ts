import { describe, expect, it } from "vitest";
import { filtrerEntites, type EntiteRecherchable } from "./recherche";

function entite(partial: Partial<EntiteRecherchable> & { libelle: string }): EntiteRecherchable {
  return {
    type: "locataire",
    id: partial.libelle,
    detail: "",
    texteRecherchable: partial.libelle.toLowerCase(),
    ...partial
  };
}

describe("filtrerEntites", () => {
  it("retourne un tableau vide pour une requête vide", () => {
    const entites = [entite({ libelle: "Jean Dupont" })];
    expect(filtrerEntites(entites, "")).toEqual([]);
    expect(filtrerEntites(entites, "   ")).toEqual([]);
  });

  it("filtre par sous-chaîne insensible à la casse", () => {
    const entites = [entite({ libelle: "Jean Dupont" }), entite({ libelle: "Marie Martin" })];
    const resultats = filtrerEntites(entites, "DUP");
    expect(resultats).toHaveLength(1);
    expect(resultats[0]?.libelle).toBe("Jean Dupont");
  });

  it("priorise les libellés qui commencent par la requête", () => {
    const entites = [
      entite({ libelle: "Jean Dupuis", texteRecherchable: "jean dupuis" }),
      entite({ libelle: "Dupont SCI", texteRecherchable: "dupont sci" })
    ];
    const resultats = filtrerEntites(entites, "dup");
    expect(resultats.map((r) => r.libelle)).toEqual(["Dupont SCI", "Jean Dupuis"]);
  });

  it("limite les résultats à 8", () => {
    const entites = Array.from({ length: 12 }, (_, i) =>
      entite({ libelle: `Locataire ${i}`, texteRecherchable: `locataire ${i}` })
    );
    expect(filtrerEntites(entites, "locataire")).toHaveLength(8);
  });

  it("ne renvoie rien si aucune correspondance", () => {
    const entites = [entite({ libelle: "Jean Dupont" })];
    expect(filtrerEntites(entites, "xyz")).toEqual([]);
  });
});
