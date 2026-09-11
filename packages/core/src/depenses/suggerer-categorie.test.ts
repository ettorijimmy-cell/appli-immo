import { describe, expect, it } from "vitest";
import { suggererCategorie } from "./suggerer-categorie";

describe("suggererCategorie", () => {
  it("suggère la catégorie quand exactement une règle correspond", () => {
    const regles = [
      { motCle: "edf", categorie: "charges_copropriete" },
      { motCle: "assurance habitation", categorie: "assurance" }
    ];
    expect(suggererCategorie("PRLV EDF ENERGIE", regles)).toBe("charges_copropriete");
  });

  it("retourne null quand aucune règle ne correspond", () => {
    const regles = [{ motCle: "edf", categorie: "charges_copropriete" }];
    expect(suggererCategorie("VIR DUPONT LOYER", regles)).toBeNull();
  });

  it("retourne null quand plusieurs règles correspondent — jamais de choix arbitraire", () => {
    const regles = [
      { motCle: "assurance", categorie: "assurance" },
      { motCle: "habitation", categorie: "reparation_entretien" }
    ];
    expect(suggererCategorie("PRLV ASSURANCE HABITATION MAIF", regles)).toBeNull();
  });

  it("retourne null quand la liste de règles est vide", () => {
    expect(suggererCategorie("PRLV EDF ENERGIE", [])).toBeNull();
  });

  it("est insensible à la casse et aux accents", () => {
    const regles = [{ motCle: "Électricité", categorie: "charges_copropriete" }];
    expect(suggererCategorie("FACTURE ELECTRICITE EDF", regles)).toBe("charges_copropriete");
  });
});
