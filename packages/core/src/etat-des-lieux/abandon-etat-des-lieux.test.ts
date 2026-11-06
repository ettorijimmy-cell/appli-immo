import { describe, expect, it } from "vitest";
import { brouillonAbandonnable, LONGUEUR_MAX_MOTIF_ABANDON, motifAbandonValide } from "./abandon-etat-des-lieux";

describe("motifAbandonValide", () => {
  it("renvoie le motif sans les espaces autour", () => {
    expect(motifAbandonValide("  Créé par erreur \n")).toBe("Créé par erreur");
  });

  it("refuse un motif vide ou fait d'espaces", () => {
    expect(motifAbandonValide("")).toBeNull();
    expect(motifAbandonValide("   \n ")).toBeNull();
  });

  it("accepte exactement la longueur maximale, refuse au-delà", () => {
    expect(motifAbandonValide("a".repeat(LONGUEUR_MAX_MOTIF_ABANDON))).toHaveLength(LONGUEUR_MAX_MOTIF_ABANDON);
    expect(motifAbandonValide("a".repeat(LONGUEUR_MAX_MOTIF_ABANDON + 1))).toBeNull();
  });
});

describe("brouillonAbandonnable", () => {
  const brouillon = { entreeSigneeParTous: false, sortieSigneeParTous: false, archivedAt: null };

  it("vrai pour un brouillon actif sans signature", () => {
    expect(brouillonAbandonnable(brouillon)).toBe(true);
  });

  it("faux dès que l'entrée ou la sortie est signée", () => {
    expect(brouillonAbandonnable({ ...brouillon, entreeSigneeParTous: true })).toBe(false);
    expect(brouillonAbandonnable({ ...brouillon, entreeSigneeParTous: true, sortieSigneeParTous: true })).toBe(false);
  });

  it("faux pour un brouillon déjà abandonné", () => {
    expect(brouillonAbandonnable({ ...brouillon, archivedAt: "2026-11-05T10:00:00.000Z" })).toBe(false);
  });
});
