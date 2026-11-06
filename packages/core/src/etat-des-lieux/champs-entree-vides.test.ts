import { describe, expect, it } from "vitest";
import { champsEntreeVides, type DonneesChampsEntree } from "./champs-entree-vides";
import {
  ELEMENTS_CHAMBRE,
  ELEMENTS_CUISINE,
  ELEMENTS_ENTREE,
  ELEMENTS_SALLE_DE_BAIN,
  ELEMENTS_SEJOUR,
  ELEMENTS_WC,
  type ElementDef
} from "./elements-pieces-etat-des-lieux";

function remplie(elements: ElementDef[], extra: Record<string, unknown> = {}) {
  return Object.fromEntries([...elements.map((e) => [`${e.prefix}EtatEntree`, "B"]), ...Object.entries(extra)]);
}

function complet(): DonneesChampsEntree {
  return {
    composition: { nombreChambres: 1, nombreSallesDeBain: 1, nombreWc: 1, autresPieces: [] },
    entree: remplie(ELEMENTS_ENTREE),
    sejour: remplie(ELEMENTS_SEJOUR),
    cuisine: remplie(ELEMENTS_CUISINE),
    chambres: [remplie(ELEMENTS_CHAMBRE, { numero: 1 })],
    sallesDeBain: [remplie(ELEMENTS_SALLE_DE_BAIN, { numero: 1 })],
    wc: [remplie(ELEMENTS_WC, { numero: 1 })],
    autres: [],
    cles: [{ typeCle: "porte_entree", nombreEntree: 2 }],
    equipementsDivers: [],
    inventaire: []
  };
}

describe("champsEntreeVides", () => {
  it("tout renseigné : aucun champ vide", () => {
    expect(champsEntreeVides(complet())).toEqual([]);
  });

  it("élément sans état d'entrée (vide, blanc ou absent), la description seule ne suffit pas", () => {
    const d = complet();
    d.sejour = { ...remplie(ELEMENTS_SEJOUR), murEtatEntree: null, solEtatEntree: "  ", plafondDescription: "Blanc" };
    delete (d.sejour as Record<string, unknown>)["plafondEtatEntree"];
    expect(champsEntreeVides(d)).toEqual([{ zone: "Séjour", manquants: ["Mur", "Sol", "Plafond"] }]);
  });

  it("pièce attendue jamais enregistrée : tous ses éléments sont listés, dans l'ordre du modèle", () => {
    const d = complet();
    d.composition.nombreChambres = 2;
    expect(champsEntreeVides(d)).toEqual([{ zone: "Chambre 2", manquants: ELEMENTS_CHAMBRE.map((e) => e.label) }]);
  });

  it("pièce non enregistrée de l'entrée : listée elle aussi", () => {
    const d = complet();
    d.entree = null;
    expect(champsEntreeVides(d)[0]).toEqual({ zone: "Entrée", manquants: ELEMENTS_ENTREE.map((e) => e.label) });
  });

  it("autre pièce : libellé saisi, sinon celui de la fiche appartement", () => {
    const d = complet();
    d.composition.autresPieces = ["Bureau", "Dressing"];
    d.autres = [{ ...remplie(ELEMENTS_CHAMBRE), numero: 1, libelle: "Bureau du fond", murEtatEntree: null }];
    expect(champsEntreeVides(d)).toEqual([
      { zone: "Bureau du fond", manquants: ["Mur"] },
      { zone: "Dressing", manquants: ELEMENTS_CHAMBRE.map((e) => e.label) }
    ]);
  });

  it("clés : aucune ligne, ou nombre d'entrée manquant (libellé « autre » saisi)", () => {
    const d = complet();
    d.cles = [];
    expect(champsEntreeVides(d)).toEqual([{ zone: "Clés", manquants: ["Aucune clé saisie"] }]);
    d.cles = [
      { typeCle: "cave", nombreEntree: null },
      { typeCle: "autre", libelleAutre: "Local vélos", nombreEntree: null },
      { typeCle: "porte_entree", nombreEntree: 1 }
    ];
    expect(champsEntreeVides(d)).toEqual([{ zone: "Clés", manquants: ["Clé de la cave", "Local vélos"] }]);
  });

  it("équipements divers et inventaire : seules les lignes saisies sans état d'entrée", () => {
    const d = complet();
    d.equipementsDivers = [
      { libelle: "Hotte", nombreEntree: 1, etatEntree: null },
      { libelle: "Store", nombreEntree: 1, etatEntree: "bon" }
    ];
    d.inventaire = [{ etatEntree: null }, { etatEntree: "bon" }, { etatEntree: null }];
    expect(champsEntreeVides(d)).toEqual([
      { zone: "Équipements divers", manquants: ["Hotte"] },
      { zone: "Inventaire", manquants: ["2 ligne(s) sans état d'entrée"] }
    ]);
  });

  it("composition inconnue (null) : aucune pièce numérotée attendue", () => {
    const d = complet();
    d.composition = { nombreChambres: null, nombreSallesDeBain: null, nombreWc: null, autresPieces: [] };
    d.chambres = [];
    d.sallesDeBain = [];
    d.wc = [];
    expect(champsEntreeVides(d)).toEqual([]);
  });
});
