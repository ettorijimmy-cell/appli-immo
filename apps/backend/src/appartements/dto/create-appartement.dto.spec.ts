import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreateAppartementDto } from "./create-appartement.dto";

const CHAMPS_VALIDES = {
  bienId: "018f1a1e-0000-7000-8000-000000000000",
  numero: "3B"
};

// Module Régularisation des charges, Sous-commit B — tantieme suit
// exactement le même traitement que surface (@IsNumberString, pas de
// normalisation virgule/point contrairement à depense.montant), aucune
// nouveauté de validation introduite ici.
describe("CreateAppartementDto — tantieme", () => {
  it("optionnel : absent ne déclenche aucune erreur", async () => {
    const dto = plainToInstance(CreateAppartementDto, { ...CHAMPS_VALIDES });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "tantieme")).toBe(false);
  });

  it("accepte un entier", async () => {
    const dto = plainToInstance(CreateAppartementDto, { ...CHAMPS_VALIDES, tantieme: "125" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "tantieme")).toBe(false);
  });

  it("accepte une décimale (notation point)", async () => {
    const dto = plainToInstance(CreateAppartementDto, { ...CHAMPS_VALIDES, tantieme: "125.50" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "tantieme")).toBe(false);
  });

  it("rejette une valeur non numérique", async () => {
    const dto = plainToInstance(CreateAppartementDto, { ...CHAMPS_VALIDES, tantieme: "abc" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "tantieme")).toBe(true);
  });
});
