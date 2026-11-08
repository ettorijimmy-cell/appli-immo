import { describe, expect, it } from "vitest";
import { situationLocataireCautionne } from "./locataire-cautionne";

describe("situationLocataireCautionne", () => {
  it("null -> non précisé, même si le bail a des locataires", () => {
    expect(situationLocataireCautionne(null, ["a", "b"])).toBe("non_precise");
  });

  it("locataire encore rattaché au bail -> au bail", () => {
    expect(situationLocataireCautionne("b", ["a", "b"])).toBe("au_bail");
  });

  it("locataire retiré du bail -> plus au bail", () => {
    expect(situationLocataireCautionne("c", ["a", "b"])).toBe("plus_au_bail");
  });

  it("bail sans locataire rattaché -> plus au bail", () => {
    expect(situationLocataireCautionne("a", [])).toBe("plus_au_bail");
  });
});
