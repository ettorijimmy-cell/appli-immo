import { describe, expect, it } from "vitest";
import { affichagePieceAutre } from "./piece-autre-affichage";

describe("affichagePieceAutre", () => {
  it("une pièce enregistrée s'affiche toujours", () => {
    expect(affichagePieceAutre({ id: "x" }, false)).toBe("carte");
    expect(affichagePieceAutre({ id: "x" }, true)).toBe("carte");
  });

  it("une pièce absente reste ajoutable tant que la sortie n'est pas signée", () => {
    expect(affichagePieceAutre(null, false)).toBe("ajouter");
  });

  it("plus aucun ajout une fois la sortie signée", () => {
    expect(affichagePieceAutre(null, true)).toBe("rien");
  });
});
