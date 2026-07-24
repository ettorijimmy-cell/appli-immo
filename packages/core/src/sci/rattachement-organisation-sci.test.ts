import { describe, expect, it } from "vitest";
import { creerRattachementProprietaire } from "./rattachement-organisation-sci";

describe("creerRattachementProprietaire", () => {
  it("rattache l'organisation créatrice à la SCI avec le rôle proprietaire", () => {
    const result = creerRattachementProprietaire({
      organisationId: "11111111-1111-7111-8111-111111111111",
      sciId: "22222222-2222-7222-8222-222222222222",
      dateDebut: "2026-07-24"
    });

    expect(result).toEqual({
      organisationId: "11111111-1111-7111-8111-111111111111",
      sciId: "22222222-2222-7222-8222-222222222222",
      role: "proprietaire",
      dateDebut: "2026-07-24",
      dateFin: null
    });
  });

  it("ne rattache jamais avec un autre rôle que proprietaire", () => {
    const result = creerRattachementProprietaire({
      organisationId: "org",
      sciId: "sci",
      dateDebut: "2026-07-24"
    });

    expect(result.role).toBe("proprietaire");
    expect(result.dateFin).toBeNull();
  });
});
