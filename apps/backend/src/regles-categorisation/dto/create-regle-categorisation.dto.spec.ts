import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreateRegleCategorisationDto } from "./create-regle-categorisation.dto";

describe("CreateRegleCategorisationDto", () => {
  it("accepte un mot-clé et une catégorie valides", async () => {
    const dto = plainToInstance(CreateRegleCategorisationDto, { motCle: "edf", categorie: "charges_copropriete" });
    const erreurs = await validate(dto);
    expect(erreurs).toHaveLength(0);
  });

  it("rejette un mot-clé vide", async () => {
    const dto = plainToInstance(CreateRegleCategorisationDto, { motCle: "", categorie: "assurance" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "motCle")).toBe(true);
  });

  it("rejette une catégorie hors de l'enum depense_categorie", async () => {
    const dto = plainToInstance(CreateRegleCategorisationDto, { motCle: "edf", categorie: "loisirs" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "categorie")).toBe(true);
  });
});
