import { describe, expect, it } from "vitest";
import { formaterListeNoms } from "./formater-liste-noms";

describe("formaterListeNoms", () => {
  it("retourne une chaîne vide pour une liste vide", () => {
    expect(formaterListeNoms([])).toBe("");
  });

  it("retourne le nom seul pour un locataire unique", () => {
    expect(formaterListeNoms(["Jean Dupont"])).toBe("Jean Dupont");
  });

  it("joint deux noms avec 'et'", () => {
    expect(formaterListeNoms(["Jean Dupont", "Marie Martin"])).toBe("Jean Dupont et Marie Martin");
  });

  it("joint trois noms ou plus avec des virgules et 'et' avant le dernier", () => {
    expect(formaterListeNoms(["Jean Dupont", "Marie Martin", "Paul Durand"])).toBe(
      "Jean Dupont, Marie Martin et Paul Durand"
    );
    expect(formaterListeNoms(["Jean Dupont", "Marie Martin", "Paul Durand", "Alice Bernard"])).toBe(
      "Jean Dupont, Marie Martin, Paul Durand et Alice Bernard"
    );
  });
});
