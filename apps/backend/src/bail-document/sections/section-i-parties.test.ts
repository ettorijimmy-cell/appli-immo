import { describe, expect, it } from "vitest";
import { construireSectionI } from "./section-i-parties";

describe("construireSectionI", () => {
  it("inclut le nom de la SCI, son adresse, son gérant et les locataires", () => {
    const contenu = JSON.stringify(
      construireSectionI({
        bailleur: {
          nom: "SCI Les Tilleuls",
          adresse: "12 rue des Tilleuls",
          codePostal: "75012",
          ville: "Paris",
          nomGerant: "Dupont",
          prenomGerant: "Marie"
        },
        locataires: [{ nom: "Martin", prenom: "Julien", email: "julien.martin@example.com" }]
      })
    );

    expect(contenu).toContain("SCI Les Tilleuls");
    expect(contenu).toContain("12 rue des Tilleuls");
    expect(contenu).toContain("75012");
    expect(contenu).toContain("Paris");
    expect(contenu).toContain("Marie Dupont");
    expect(contenu).toContain("Julien Martin");
  });

  it("gère la colocation : tous les locataires apparaissent", () => {
    const contenu = JSON.stringify(
      construireSectionI({
        bailleur: {
          nom: "SCI Test",
          adresse: "1 rue Test",
          codePostal: null,
          ville: null,
          nomGerant: null,
          prenomGerant: null
        },
        locataires: [
          { nom: "Petit", prenom: "Anne", email: null },
          { nom: "Grand", prenom: "Paul", email: null }
        ]
      })
    );

    expect(contenu).toContain("Anne Petit");
    expect(contenu).toContain("Paul Grand");
  });

  it("sans gérant renseigné, ne mentionne aucun représentant", () => {
    const contenu = JSON.stringify(
      construireSectionI({
        bailleur: {
          nom: "SCI Sans Gerant",
          adresse: "1 rue Test",
          codePostal: null,
          ville: null,
          nomGerant: null,
          prenomGerant: null
        },
        locataires: []
      })
    );

    expect(contenu).not.toContain("représentée par son gérant");
  });
});
