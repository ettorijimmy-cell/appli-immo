import { describe, expect, it } from "vitest";
import { adresseEnvoiValide } from "./adresse-envoi";

describe("adresseEnvoiValide", () => {
  it.each(["jean.dupont@example.com", "j+remise@sous.domaine.example.fr", "JEAN@EXAMPLE.COM"])("accepte %s", (adresse) => {
    expect(adresseEnvoiValide(adresse)).toBe(true);
  });

  it.each([
    ["deux adresses, virgule", "a@example.com,b@example.com"],
    ["virgule et espace", "a@example.com, b@example.com"],
    ["point-virgule", "a@example.com;b@example.com"],
    ["virgule finale", "a@example.com,"],
    ["chevrons", "Jean <a@example.com>"],
    ["guillemets", '"a,b"@example.com'],
    ["espace", "a b@example.com"],
    ["espace autour", " a@example.com"],
    ["retour à la ligne", "a@example.com\nBcc: b@example.com"],
    ["sans arobase", "a.example.com"],
    ["sans domaine", "a@"],
    ["sans point dans le domaine", "a@example"],
    ["vide", ""]
  ])("refuse : %s", (_cas, adresse) => {
    expect(adresseEnvoiValide(adresse)).toBe(false);
  });

  it("refuse une absence d'adresse", () => {
    expect(adresseEnvoiValide(null)).toBe(false);
    expect(adresseEnvoiValide(undefined)).toBe(false);
  });
});
