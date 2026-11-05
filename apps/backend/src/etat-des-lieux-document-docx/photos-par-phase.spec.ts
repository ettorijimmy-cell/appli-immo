import { describe, expect, it } from "vitest";
import { groupesPhotosPiece, photosDuDocument, type PhotoEtatDesLieux } from "./photos-par-phase";

function photo(
  id: string,
  type: string,
  phase: "entree" | "sortie" | null,
  numero: number | null = null
): PhotoEtatDesLieux {
  return { id, etatDesLieuxPieceType: type, etatDesLieuxPieceNumero: numero, etatDesLieuxPhase: phase };
}

const photos = [
  photo("e1", "sejour", "entree"),
  photo("n1", "sejour", null),
  photo("s1", "sejour", "sortie"),
  photo("c1", "chambre", "sortie", 1),
  photo("c2", "chambre", "entree", 2)
];

describe("groupesPhotosPiece", () => {
  it("sépare l'entrée et la sortie, une photo sans phase comptant comme entrée", () => {
    expect(groupesPhotosPiece(photos, "sejour", null)).toEqual([
      { titre: "Photos à l'entrée", images: ["e1", "n1"] },
      { titre: "Photos à la sortie", images: ["s1"] }
    ]);
  });

  it("omet un groupe vide et respecte le numéro de la pièce", () => {
    expect(groupesPhotosPiece(photos, "chambre", 1)).toEqual([{ titre: "Photos à la sortie", images: ["c1"] }]);
    expect(groupesPhotosPiece(photos, "chambre", 2)).toEqual([{ titre: "Photos à l'entrée", images: ["c2"] }]);
    expect(groupesPhotosPiece(photos, "cuisine", null)).toEqual([]);
  });
});

describe("photosDuDocument", () => {
  it("document d'entrée : jamais de photo de sortie", () => {
    expect(photosDuDocument(photos, false).map((p) => p.id)).toEqual(["e1", "n1", "c2"]);
  });

  it("document de sortie : toutes les photos", () => {
    expect(photosDuDocument(photos, true)).toHaveLength(5);
  });
});
