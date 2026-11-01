import { describe, expect, it } from "vitest";
import { resoudreNouvelleAdresseSortie } from "./nouvelle-adresse-sortie";

describe("resoudreNouvelleAdresseSortie", () => {
  it("retient la saisie, sans espaces autour", () => {
    expect(resoudreNouvelleAdresseSortie("  12 rue du Départ, 69001 Lyon\n", null)).toBe("12 rue du Départ, 69001 Lyon");
  });

  it("conserve les retours à la ligne entre colocataires", () => {
    expect(resoudreNouvelleAdresseSortie("Jean Dupont : 1 rue A\nAlex Martin : 2 rue B", null)).toBe(
      "Jean Dupont : 1 rue A\nAlex Martin : 2 rue B"
    );
  });

  it("accepte une mention en texte libre", () => {
    expect(resoudreNouvelleAdresseSortie("Non communiquée par le locataire", null)).toBe(
      "Non communiquée par le locataire"
    );
  });

  it("la saisie l'emporte sur la valeur enregistrée", () => {
    expect(resoudreNouvelleAdresseSortie("Nouvelle saisie", "Ancienne valeur")).toBe("Nouvelle saisie");
  });

  it("sans saisie, reprend la valeur enregistrée", () => {
    expect(resoudreNouvelleAdresseSortie(undefined, " Valeur enregistrée ")).toBe("Valeur enregistrée");
    expect(resoudreNouvelleAdresseSortie(null, "Valeur enregistrée")).toBe("Valeur enregistrée");
  });

  it("une saisie vide ne retombe jamais sur la valeur enregistrée", () => {
    expect(resoudreNouvelleAdresseSortie("   ", "Ancienne valeur")).toBeNull();
    expect(resoudreNouvelleAdresseSortie("", "Ancienne valeur")).toBeNull();
  });

  it("null si rien n'est exploitable", () => {
    expect(resoudreNouvelleAdresseSortie(undefined, undefined)).toBeNull();
    expect(resoudreNouvelleAdresseSortie(null, null)).toBeNull();
    expect(resoudreNouvelleAdresseSortie(undefined, "   ")).toBeNull();
  });
});
