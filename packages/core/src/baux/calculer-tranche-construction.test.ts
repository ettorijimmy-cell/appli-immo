import { describe, expect, it } from "vitest";
import { calculerTrancheConstruction, libelleTrancheConstruction } from "./calculer-tranche-construction";

describe("calculerTrancheConstruction", () => {
  it("avant 1949", () => {
    expect(calculerTrancheConstruction(1948)).toBe("avant_1949");
  });

  it("borne basse de 1949-1974", () => {
    expect(calculerTrancheConstruction(1949)).toBe("de_1949_a_1974");
  });

  it("borne haute de 1949-1974", () => {
    expect(calculerTrancheConstruction(1974)).toBe("de_1949_a_1974");
  });

  it("bascule vers 1975-1989 dès 1975 (résout le chevauchement officiel à 1989)", () => {
    expect(calculerTrancheConstruction(1975)).toBe("de_1975_a_1989");
  });

  it("1988 reste dans 1975-1989 — 1989 bascule dans la tranche suivante", () => {
    expect(calculerTrancheConstruction(1988)).toBe("de_1975_a_1989");
    expect(calculerTrancheConstruction(1989)).toBe("de_1989_a_2005");
  });

  it("2004 reste dans 1989-2005 — 2005 bascule dans depuis_2005 (résout le chevauchement officiel à 2005)", () => {
    expect(calculerTrancheConstruction(2004)).toBe("de_1989_a_2005");
    expect(calculerTrancheConstruction(2005)).toBe("depuis_2005");
  });

  it("depuis 2005, années récentes", () => {
    expect(calculerTrancheConstruction(2026)).toBe("depuis_2005");
  });
});

describe("libelleTrancheConstruction", () => {
  it("reproduit le texte exact du contrat-type pour chaque tranche", () => {
    expect(libelleTrancheConstruction("avant_1949")).toBe("avant 1949");
    expect(libelleTrancheConstruction("de_1949_a_1974")).toBe("de 1949 à 1974");
    expect(libelleTrancheConstruction("de_1975_a_1989")).toBe("de 1975 à 1989");
    expect(libelleTrancheConstruction("de_1989_a_2005")).toBe("de 1989 à 2005");
    expect(libelleTrancheConstruction("depuis_2005")).toBe("depuis 2005");
  });
});
