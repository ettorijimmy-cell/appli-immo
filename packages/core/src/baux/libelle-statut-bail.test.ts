import { describe, expect, it } from "vitest";
import { libelleStatutBail } from "./libelle-statut-bail";

describe("libelleStatutBail", () => {
  it("un libellé lisible pour chaque valeur de l'enum bail_statut", () => {
    expect(libelleStatutBail("brouillon")).toBe("Brouillon");
    expect(libelleStatutBail("actif")).toBe("Actif");
    expect(libelleStatutBail("preavis")).toBe("En préavis");
    expect(libelleStatutBail("resilie")).toBe("Résilié");
    expect(libelleStatutBail("archive")).toBe("Archivé");
  });
});
