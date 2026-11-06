import { describe, expect, it } from "vitest";
import type { SignaturePosee } from "./api";
import { classeChamp, dateSignaturePhase, figementCarte } from "./figement-carte";

function signature(phase: "entree" | "sortie", signeLe: string): SignaturePosee {
  return { phase, role: "bailleur", locataireId: null, nomAffiche: "SCI", luEtApprouve: true, documentId: "d", signeLe };
}

const signatures = [
  signature("entree", "2026-01-15T12:00:00Z"),
  signature("sortie", "2026-10-30T12:00:00Z"),
  signature("sortie", "2026-10-31T12:00:00Z")
];

describe("dateSignaturePhase", () => {
  it("retient la dernière signature de la phase", () => {
    expect(dateSignaturePhase(signatures, "sortie")).toBe("31/10/2026");
  });

  it("renvoie null sans signature pour cette phase", () => {
    expect(dateSignaturePhase([], "entree")).toBeNull();
  });
});

describe("figementCarte", () => {
  it("aucun badge avant toute signature", () => {
    expect(figementCarte(false, false, [])).toBeNull();
  });

  it("entrée signée : limite le badge aux champs d'entrée", () => {
    expect(figementCarte(true, false, signatures)).toEqual({
      phase: "entree",
      texte: "Figé par la signature d'entrée du 15/01/2026 (champs d'entrée)"
    });
  });

  it("sortie signée : la signature de sortie l'emporte", () => {
    expect(figementCarte(true, true, signatures)).toEqual({
      phase: "sortie",
      texte: "Figé par la signature de sortie du 31/10/2026"
    });
  });

  it("entrée papier : figé par la déclaration papier, à la date portée sur le papier", () => {
    expect(figementCarte(true, false, [], { dateSignature: "2026-08-01" })).toEqual({
      phase: "entree",
      texte: "Figé par la déclaration papier du 01/08/2026 (champs d'entrée)"
    });
  });

  it("entrée papier puis sortie signée : la signature de sortie l'emporte", () => {
    expect(figementCarte(true, true, signatures, { dateSignature: "2026-08-01" })?.texte).toBe(
      "Figé par la signature de sortie du 31/10/2026"
    );
  });

  it("omet la date tant que les signatures ne sont pas chargées", () => {
    expect(figementCarte(true, true, [])?.texte).toBe("Figé par la signature de sortie");
    expect(figementCarte(true, false, [])?.texte).toBe("Figé par la signature d'entrée (champs d'entrée)");
  });
});

describe("classeChamp", () => {
  it("retire la bordure de saisie d'un champ figé", () => {
    expect(classeChamp(true)).toContain("border-slate-300");
    expect(classeChamp(false)).toContain("border-transparent");
  });
});
