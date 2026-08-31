import { describe, expect, it } from "vitest";
import { calculerRevisionLoyer } from "./calculer-revision-loyer";

describe("calculerRevisionLoyer", () => {
  it("cas nominal : indice en hausse, le loyer augmente", () => {
    expect(calculerRevisionLoyer("700.00", "145.50", "143.00")).toBe("712.23");
  });

  it("indice en baisse : la révision peut réduire le loyer, pas seulement l'augmenter", () => {
    expect(calculerRevisionLoyer("700.00", "140.00", "143.00")).toBe("685.31");
  });

  it("indices identiques : loyer inchangé", () => {
    expect(calculerRevisionLoyer("700.00", "143.00", "143.00")).toBe("700.00");
  });

  it("lève une erreur explicite si indicePrecedent est nul", () => {
    expect(() => calculerRevisionLoyer("700.00", "145.50", "0.00")).toThrow(/indicePrecedent/);
  });

  it("lève une erreur explicite si indicePrecedent est négatif", () => {
    expect(() => calculerRevisionLoyer("700.00", "145.50", "-1.00")).toThrow(/indicePrecedent/);
  });
});
