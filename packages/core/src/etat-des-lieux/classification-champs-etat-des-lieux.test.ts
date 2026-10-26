import { describe, expect, it } from "vitest";
import { champFigeParSignature, champModifiable, CLASSIFICATION_CLES } from "./classification-champs-etat-des-lieux";

describe("champFigeParSignature", () => {
  it("rien n'est figé tant qu'aucune phase n'est signée", () => {
    expect(champFigeParSignature("entree", false, false)).toBe(false);
    expect(champFigeParSignature("sortie", false, false)).toBe(false);
    expect(champFigeParSignature("commune", false, false)).toBe(false);
  });

  it("entrée signée : figé sauf pour un champ sortie", () => {
    expect(champFigeParSignature("entree", true, false)).toBe(true);
    expect(champFigeParSignature("commune", true, false)).toBe(true);
    expect(champFigeParSignature("sortie", true, false)).toBe(false);
  });

  it("sortie signée : tout est figé, y compris un champ sortie", () => {
    expect(champFigeParSignature("sortie", true, true)).toBe(true);
    expect(champFigeParSignature("entree", true, true)).toBe(true);
    expect(champFigeParSignature("commune", true, true)).toBe(true);
  });
});

describe("champModifiable", () => {
  const base = { classification: CLASSIFICATION_CLES, champsIdentite: new Set(["typeCle", "libelleAutre"]) };

  it("tout reste modifiable avant toute signature, ligne existante ou pas", () => {
    expect(
      champModifiable({ ...base, nomChamp: "libelleAutre", ligneExistante: true, entreeSignee: false, sortieSignee: false })
    ).toBe(true);
    expect(
      champModifiable({ ...base, nomChamp: "commentaire", ligneExistante: false, entreeSignee: false, sortieSignee: false })
    ).toBe(true);
  });

  it("entrée signée, ligne existante : seul un champ sortie reste modifiable", () => {
    const params = { ...base, ligneExistante: true, entreeSignee: true, sortieSignee: false };
    expect(champModifiable({ ...params, nomChamp: "nombreSortie" })).toBe(true);
    expect(champModifiable({ ...params, nomChamp: "nombreEntree" })).toBe(false);
    expect(champModifiable({ ...params, nomChamp: "libelleAutre" })).toBe(false);
    expect(champModifiable({ ...params, nomChamp: "commentaire" })).toBe(false);
  });

  it("entrée signée, ligne NEUVE : identité et champ sortie modifiables, pas le reste", () => {
    const params = { ...base, ligneExistante: false, entreeSignee: true, sortieSignee: false };
    expect(champModifiable({ ...params, nomChamp: "libelleAutre" })).toBe(true);
    expect(champModifiable({ ...params, nomChamp: "typeCle" })).toBe(true);
    expect(champModifiable({ ...params, nomChamp: "nombreSortie" })).toBe(true);
    expect(champModifiable({ ...params, nomChamp: "commentaire" })).toBe(false);
  });

  it("sortie signée : plus rien n'est modifiable, ligne existante ou neuve", () => {
    expect(
      champModifiable({ ...base, nomChamp: "nombreSortie", ligneExistante: true, entreeSignee: true, sortieSignee: true })
    ).toBe(false);
    expect(
      champModifiable({ ...base, nomChamp: "libelleAutre", ligneExistante: false, entreeSignee: true, sortieSignee: true })
    ).toBe(false);
  });

  it("sans champsIdentite fourni, une ligne neuve ne bénéficie d'aucune exception", () => {
    expect(
      champModifiable({
        classification: CLASSIFICATION_CLES,
        nomChamp: "libelleAutre",
        ligneExistante: false,
        entreeSignee: true,
        sortieSignee: false
      })
    ).toBe(false);
  });
});
