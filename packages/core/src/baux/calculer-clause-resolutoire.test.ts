import { describe, expect, it } from "vitest";
import {
  construireTexteClauseResolutoire,
  determinerRegimeClauseResolutoire
} from "./calculer-clause-resolutoire";

describe("determinerRegimeClauseResolutoire", () => {
  it("bascule à la date exacte du 1er octobre 2026 (décret n° 2026-596, article 3)", () => {
    expect(determinerRegimeClauseResolutoire("2026-09-30")).toBe("avant_2026_10_01");
    expect(determinerRegimeClauseResolutoire("2026-10-01")).toBe("depuis_2026_10_01");
    expect(determinerRegimeClauseResolutoire("2026-10-02")).toBe("depuis_2026_10_01");
  });

  it("bien avant/après la bascule", () => {
    expect(determinerRegimeClauseResolutoire("2025-01-01")).toBe("avant_2026_10_01");
    expect(determinerRegimeClauseResolutoire("2027-01-01")).toBe("depuis_2026_10_01");
  });
});

describe("construireTexteClauseResolutoire", () => {
  it("avant le 1er octobre 2026 : deux délais distincts, jamais regroupés sous un seul", () => {
    const texte = construireTexteClauseResolutoire("avant_2026_10_01", false);
    expect(texte).toContain("loyer");
    expect(texte).toContain("charges");
    expect(texte).toContain("dépôt de garantie");
    expect(texte).toContain("assurance");
    expect(texte).not.toContain("six semaines");

    // "Il en est de même" sépare les deux phrases du texte : tout ce qui
    // précède porte sur loyer/charges/dépôt de garantie (doit dire "deux
    // mois", jamais "un mois"), tout ce qui suit porte sur assurance/
    // troubles de voisinage ("un mois"). Un test qui se contente de
    // vérifier la présence des deux délais sans vérifier leur portée
    // respective ne détecte pas un bug de regroupement (un seul délai
    // appliqué à tous les motifs) — c'est précisément le bug corrigé ici.
    const indexSecondMotif = texte.indexOf("Il en est de même");
    const premierMotif = texte.slice(0, indexSecondMotif);
    const secondMotif = texte.slice(indexSecondMotif);
    expect(premierMotif).toContain("deux mois");
    expect(premierMotif).not.toContain("un mois");
    expect(secondMotif).toContain("un mois");
  });

  it("depuis le 1er octobre 2026 : deux délais distincts (six semaines / un mois), même structure qu'avant", () => {
    const texte = construireTexteClauseResolutoire("depuis_2026_10_01", false);
    expect(texte).toContain("loyer");
    expect(texte).toContain("charges");
    expect(texte).toContain("versement du dépôt de garantie");
    expect(texte).toContain("assurance");
    expect(texte).not.toContain("servitude");

    const indexSecondMotif = texte.indexOf("Il en est de même");
    const premierMotif = texte.slice(0, indexSecondMotif);
    const secondMotif = texte.slice(indexSecondMotif);
    expect(premierMotif).toContain("six semaines");
    expect(premierMotif).not.toContain("un mois");
    expect(secondMotif).toContain("un mois");
    expect(secondMotif).not.toContain("six semaines");
  });

  it("mentionne la servitude de résidence principale uniquement si applicable", () => {
    const sansServitude = construireTexteClauseResolutoire("depuis_2026_10_01", false);
    expect(sansServitude).not.toContain("résidence principale");

    const avecServitude = construireTexteClauseResolutoire("depuis_2026_10_01", true);
    expect(avecServitude).toContain("résidence principale");
  });

  it("ne mentionne jamais de pénalité/amende — l'article 4 i) de la loi 1989 les interdit sans exception", () => {
    const avant = construireTexteClauseResolutoire("avant_2026_10_01", false);
    const apres = construireTexteClauseResolutoire("depuis_2026_10_01", true);
    expect(avant.toLowerCase()).not.toContain("pénal");
    expect(avant.toLowerCase()).not.toContain("amende");
    expect(apres.toLowerCase()).not.toContain("pénal");
    expect(apres.toLowerCase()).not.toContain("amende");
  });
});
