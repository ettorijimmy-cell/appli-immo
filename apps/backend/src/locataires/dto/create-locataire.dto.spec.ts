import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreateLocataireDto } from "./create-locataire.dto";

describe("CreateLocataireDto", () => {
  it("nom vide est rejeté (MinLength(1))", async () => {
    const dto = plainToInstance(CreateLocataireDto, { nom: "", prenom: "Martin" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "nom")).toBe(true);
  });

  it("prenom vide est rejeté (MinLength(1))", async () => {
    const dto = plainToInstance(CreateLocataireDto, { nom: "Dupont", prenom: "" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "prenom")).toBe(true);
  });

  it("accepte adresse/codePostal/ville à la création (point 6b, docs/backlog.md)", async () => {
    const dto = plainToInstance(CreateLocataireDto, {
      nom: "Dupont",
      prenom: "Martin",
      adresse: "12 rue des Lilas",
      codePostal: "75001",
      ville: "Paris"
    });
    const erreurs = await validate(dto);
    expect(erreurs).toHaveLength(0);
  });

  it("adresse/codePostal/ville/dateNaissance absents ne déclenchent aucune erreur", async () => {
    const dto = plainToInstance(CreateLocataireDto, { nom: "Dupont", prenom: "Martin" });
    const erreurs = await validate(dto);
    expect(erreurs).toHaveLength(0);
  });

  it("dateNaissance invalide (mal formée) est rejetée", async () => {
    const dto = plainToInstance(CreateLocataireDto, {
      nom: "Dupont",
      prenom: "Martin",
      dateNaissance: "pas-une-date"
    });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "dateNaissance")).toBe(true);
  });

  it("email invalide (mal formé) est rejeté", async () => {
    const dto = plainToInstance(CreateLocataireDto, {
      nom: "Dupont",
      prenom: "Martin",
      email: "pas-un-email"
    });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "email")).toBe(true);
  });
});
