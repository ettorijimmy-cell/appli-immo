import { describe, expect, it } from "vitest";
import { ordonnerGarantsDuBail, ordonnerLocatairesDuBail } from "./ordonner-parties-bail";

describe("ordonnerGarantsDuBail", () => {
  it("trie par date de saisie croissante, quel que soit l'ordre reçu", () => {
    const garants = [
      { id: "c", createdAt: new Date("2026-03-01T10:00:00Z") },
      { id: "a", createdAt: new Date("2026-01-01T10:00:00Z") },
      { id: "b", createdAt: new Date("2026-02-01T10:00:00Z") }
    ];
    expect(ordonnerGarantsDuBail(garants).map((g) => g.id)).toEqual(["a", "b", "c"]);
  });

  it("départage deux saisies simultanées par id croissant", () => {
    const meme = "2026-01-01T10:00:00.000Z";
    const garants = [
      { id: "019a0000-0000-7000-8000-000000000002", createdAt: meme },
      { id: "019a0000-0000-7000-8000-000000000001", createdAt: meme }
    ];
    expect(ordonnerGarantsDuBail(garants).map((g) => g.id)).toEqual([
      "019a0000-0000-7000-8000-000000000001",
      "019a0000-0000-7000-8000-000000000002"
    ]);
  });

  it("ne modifie jamais le tableau reçu", () => {
    const garants = [
      { id: "b", createdAt: "2026-02-01T00:00:00Z" },
      { id: "a", createdAt: "2026-01-01T00:00:00Z" }
    ];
    ordonnerGarantsDuBail(garants);
    expect(garants.map((g) => g.id)).toEqual(["b", "a"]);
  });

  it("liste vide -> liste vide", () => {
    expect(ordonnerGarantsDuBail([])).toEqual([]);
  });
});

describe("ordonnerLocatairesDuBail", () => {
  it("place le titulaire en premier même s'il a été rattaché après un colocataire", () => {
    const liens = [
      { id: "coloc", role: "colocataire" as const, createdAt: "2026-01-01T00:00:00Z" },
      { id: "titulaire", role: "titulaire" as const, createdAt: "2026-02-01T00:00:00Z" }
    ];
    expect(ordonnerLocatairesDuBail(liens).map((l) => l.id)).toEqual(["titulaire", "coloc"]);
  });

  it("ordonne les colocataires par date de saisie, puis par id", () => {
    const liens = [
      { id: "coloc-3", role: "colocataire" as const, createdAt: "2026-03-01T00:00:00Z" },
      { id: "coloc-2b", role: "colocataire" as const, createdAt: "2026-02-01T00:00:00Z" },
      { id: "titulaire", role: "titulaire" as const, createdAt: "2026-04-01T00:00:00Z" },
      { id: "coloc-2a", role: "colocataire" as const, createdAt: "2026-02-01T00:00:00Z" }
    ];
    expect(ordonnerLocatairesDuBail(liens).map((l) => l.id)).toEqual(["titulaire", "coloc-2a", "coloc-2b", "coloc-3"]);
  });

  it("sans titulaire, garde le simple ordre de saisie", () => {
    const liens = [
      { id: "b", role: "colocataire" as const, createdAt: "2026-02-01T00:00:00Z" },
      { id: "a", role: "colocataire" as const, createdAt: "2026-01-01T00:00:00Z" }
    ];
    expect(ordonnerLocatairesDuBail(liens).map((l) => l.id)).toEqual(["a", "b"]);
  });
});
