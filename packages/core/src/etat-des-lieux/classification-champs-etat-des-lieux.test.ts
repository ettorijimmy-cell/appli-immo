import { describe, expect, it } from "vitest";
import {
  champFigeParSignature,
  champModifiable,
  CLASSIFICATION_CLES,
  CLASSIFICATION_EQUIPEMENTS_DIVERS,
  CLASSIFICATION_ETATS_DES_LIEUX,
  CLASSIFICATION_INVENTAIRE,
  CLASSIFICATION_PIECE_AUTRE,
  CLASSIFICATION_PIECE_CHAMBRE,
  CLASSIFICATION_PIECE_CUISINE,
  CLASSIFICATION_PIECE_ENTREE,
  CLASSIFICATION_PIECE_SALLE_DE_BAIN,
  CLASSIFICATION_PIECE_SEJOUR,
  CLASSIFICATION_PIECE_WC
} from "./classification-champs-etat-des-lieux";

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

describe("observations et réserves", () => {
  it("général : chaque champ suit la phase qu'il décrit", () => {
    expect(CLASSIFICATION_ETATS_DES_LIEUX).toMatchObject({
      observationsBailleurEntree: "entree",
      reservesLocataireEntree: "entree",
      observationsBailleurSortie: "sortie",
      reservesLocataireSortie: "sortie"
    });
  });

  it.each([
    ["entrée", CLASSIFICATION_PIECE_ENTREE],
    ["séjour", CLASSIFICATION_PIECE_SEJOUR],
    ["cuisine", CLASSIFICATION_PIECE_CUISINE],
    ["chambre", CLASSIFICATION_PIECE_CHAMBRE],
    ["salle de bain", CLASSIFICATION_PIECE_SALLE_DE_BAIN],
    ["WC", CLASSIFICATION_PIECE_WC],
    ["autre", CLASSIFICATION_PIECE_AUTRE]
  ])("pièce %s : observations de sortie encore modifiables après l'entrée signée", (_nom, classification) => {
    expect(classification["observationsSortie"]).toBe("sortie");
  });

  it.each([
    ["clés", CLASSIFICATION_CLES],
    ["équipements divers", CLASSIFICATION_EQUIPEMENTS_DIVERS],
    ["inventaire", CLASSIFICATION_INVENTAIRE]
  ])("%s : commentaire de sortie distinct du commentaire d'entrée", (_nom, classification) => {
    expect(classification["commentaireSortie"]).toBe("sortie");
    expect(classification["commentaire"]).toBe("commune");
  });
});
