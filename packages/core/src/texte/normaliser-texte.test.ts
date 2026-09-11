import { describe, expect, it } from "vitest";
import { libelleContient, normaliserPourCorrespondance } from "./normaliser-texte";

describe("normaliserPourCorrespondance", () => {
  it("met en minuscule", () => {
    expect(normaliserPourCorrespondance("EDF ENERGIE")).toBe("edf energie");
  });

  it("retire les accents", () => {
    expect(normaliserPourCorrespondance("Électricité")).toBe("electricite");
  });

  it("neutralise la ponctuation en espace", () => {
    expect(normaliserPourCorrespondance("VIR/DUPONT-LOYER.AOUT")).toBe("vir dupont loyer aout");
  });

  it("retire les espaces en début/fin après neutralisation", () => {
    expect(normaliserPourCorrespondance("  Dupont  ")).toBe("dupont");
  });
});

describe("libelleContient", () => {
  it("détecte une correspondance partielle insensible à la casse", () => {
    expect(libelleContient("VIR DUPONT LOYER AOUT", "dupont")).toBe(true);
  });

  it("détecte une correspondance insensible aux accents", () => {
    expect(libelleContient("FACTURE ÉLECTRICITÉ EDF", "electricite")).toBe(true);
  });

  it("détecte une correspondance malgré la ponctuation du libellé", () => {
    expect(libelleContient("VIR/DUPONT-LOYER.AOUT", "dupont loyer")).toBe(true);
  });

  it("retourne false si le motif est absent", () => {
    expect(libelleContient("VIR MARTIN LOYER", "dupont")).toBe(false);
  });

  it("retourne false si le motif est vide", () => {
    expect(libelleContient("VIR DUPONT LOYER", "")).toBe(false);
  });

  it("retourne false si le motif est vide après normalisation (ponctuation seule)", () => {
    expect(libelleContient("VIR DUPONT LOYER", "---")).toBe(false);
  });
});
