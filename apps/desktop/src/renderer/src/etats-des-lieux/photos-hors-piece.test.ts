import { describe, expect, it } from "vitest";
import type { DocumentMetier } from "../documents/api";
import { photosHorsPiece, type PiecesAffichees } from "./photos-hors-piece";

function photo(id: string, surcharge: Partial<DocumentMetier>): DocumentMetier {
  return {
    id,
    archivedAt: null,
    etatDesLieuxPieceType: "sejour",
    etatDesLieuxPieceNumero: null,
    etatDesLieuxPhase: "entree",
    ...surcharge
  } as DocumentMetier;
}

const AFFICHEES: PiecesAffichees = { chambre: [1], salle_de_bain: [1], wc: [], autre: [2] };

describe("photosHorsPiece", () => {
  it("photos affichées sous une pièce : aucune hors pièce", () => {
    expect(
      photosHorsPiece(
        [
          photo("a", { etatDesLieuxPieceType: "entree" }),
          photo("b", { etatDesLieuxPieceType: "sejour" }),
          photo("c", { etatDesLieuxPieceType: "cuisine" }),
          photo("d", { etatDesLieuxPieceType: "chambre", etatDesLieuxPieceNumero: 1 }),
          photo("e", { etatDesLieuxPieceType: "salle_de_bain", etatDesLieuxPieceNumero: 1 }),
          photo("f", { etatDesLieuxPieceType: "autre", etatDesLieuxPieceNumero: 2 })
        ],
        AFFICHEES
      )
    ).toEqual([]);
  });

  it("sans pièce, ou rattachée à une pièce absente de la vue : hors pièce", () => {
    const resultat = photosHorsPiece(
      [
        photo("sans", { etatDesLieuxPieceType: null }),
        photo("chambre2", { etatDesLieuxPieceType: "chambre", etatDesLieuxPieceNumero: 2 }),
        photo("wc1", { etatDesLieuxPieceType: "wc", etatDesLieuxPieceNumero: 1 }),
        photo("autre1", { etatDesLieuxPieceType: "autre", etatDesLieuxPieceNumero: 1 }),
        photo("chambreSansNumero", { etatDesLieuxPieceType: "chambre", etatDesLieuxPieceNumero: null }),
        photo("sejourNumerote", { etatDesLieuxPieceType: "sejour", etatDesLieuxPieceNumero: 1 })
      ],
      AFFICHEES
    );
    expect(resultat.map((p) => p.id)).toEqual([
      "sans",
      "chambre2",
      "wc1",
      "autre1",
      "chambreSansNumero",
      "sejourNumerote"
    ]);
  });
});
