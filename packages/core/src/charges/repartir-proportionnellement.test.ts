import { describe, expect, it } from "vitest";
import { repartirProportionnellement } from "./repartir-proportionnellement";

describe("repartirProportionnellement", () => {
  it("répartit exactement quand la division tombe juste", () => {
    const resultat = repartirProportionnellement(10000, [
      { id: "a", poids: 50 },
      { id: "b", poids: 50 }
    ]);
    expect(resultat).toEqual([
      { id: "a", montantCentimes: 5000 },
      { id: "b", montantCentimes: 5000 }
    ]);
  });

  it("distribue le reste par la méthode du plus grand reste, de façon déterministe", () => {
    const resultat = repartirProportionnellement(100, [
      { id: "a", poids: 1 },
      { id: "b", poids: 1 },
      { id: "c", poids: 1 }
    ]);
    // 100 / 3 = 33.33... pour chacun — un seul centime à distribuer, le
    // premier du tableau d'origine le reçoit (restes exactement égaux).
    expect(resultat).toEqual([
      { id: "a", montantCentimes: 34 },
      { id: "b", montantCentimes: 33 },
      { id: "c", montantCentimes: 33 }
    ]);
    expect(resultat.reduce((total, r) => total + r.montantCentimes, 0)).toBe(100);
  });

  it("un seul lot reçoit la totalité", () => {
    const resultat = repartirProportionnellement(12345, [{ id: "a", poids: 42 }]);
    expect(resultat).toEqual([{ id: "a", montantCentimes: 12345 }]);
  });

  it("un poids à zéro reçoit 0, ne plante jamais", () => {
    const resultat = repartirProportionnellement(1000, [
      { id: "a", poids: 100 },
      { id: "b", poids: 0 }
    ]);
    expect(resultat).toEqual([
      { id: "a", montantCentimes: 1000 },
      { id: "b", montantCentimes: 0 }
    ]);
  });

  it("répartition proportionnelle à des poids inégaux avec reste", () => {
    // 2500 centimes au prorata de tantièmes 125/1000e et 75/1000e sur un
    // total de 200 : 2500*125/200=1562.5, 2500*75/200=937.5 — un centime à
    // distribuer, attribué au plus grand reste fractionnaire (égalité ici
    // aussi : 0.5 partout, le premier du tableau tranche).
    const resultat = repartirProportionnellement(2500, [
      { id: "lotA", poids: 125 },
      { id: "lotB", poids: 75 }
    ]);
    expect(resultat).toEqual([
      { id: "lotA", montantCentimes: 1563 },
      { id: "lotB", montantCentimes: 937 }
    ]);
    expect(resultat.reduce((total, r) => total + r.montantCentimes, 0)).toBe(2500);
  });

  it("tableau de poids vide retourne un tableau vide", () => {
    expect(repartirProportionnellement(500, [])).toEqual([]);
  });

  it("somme des poids nulle et montant nul : toutes les parts à 0, pas d'erreur", () => {
    const resultat = repartirProportionnellement(0, [
      { id: "a", poids: 0 },
      { id: "b", poids: 0 }
    ]);
    expect(resultat).toEqual([
      { id: "a", montantCentimes: 0 },
      { id: "b", montantCentimes: 0 }
    ]);
  });

  it("somme des poids nulle mais montant non nul : erreur explicite, jamais une division silencieuse", () => {
    expect(() => repartirProportionnellement(1000, [{ id: "a", poids: 0 }])).toThrow();
  });
});
