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
  it("avant le 1er octobre 2026 : texte facultatif à un mois, quatre motifs regroupés", () => {
    const texte = construireTexteClauseResolutoire("avant_2026_10_01", false);
    expect(texte).toContain("un mois");
    expect(texte).toContain("loyer");
    expect(texte).toContain("charges");
    expect(texte).toContain("dépôt de garantie");
    expect(texte).toContain("assurance");
    expect(texte).not.toContain("six semaines");
  });

  it("depuis le 1er octobre 2026 : délai de six semaines pour loyer/charges/dépôt, motifs facultatifs séparés", () => {
    const texte = construireTexteClauseResolutoire("depuis_2026_10_01", false);
    expect(texte).toContain("six semaines");
    expect(texte).toContain("loyer");
    expect(texte).toContain("charges");
    expect(texte).toContain("versement du dépôt de garantie");
    expect(texte).toContain("assurance");
    expect(texte).not.toContain("servitude");
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
