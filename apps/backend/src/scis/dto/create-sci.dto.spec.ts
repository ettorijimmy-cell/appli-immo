import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreateSciDto } from "./create-sci.dto";

const CHAMPS_VALIDES = {
  nom: "SCI Les Tilleuls",
  regimeFiscal: "IR",
  adresse: "1 rue de Test",
  codePostal: "75001",
  ville: "Paris"
};

// Point 6d (docs/backlog.md) : telephone/estFamiliale sont désormais
// proposés dès la création, optionnels, sans valeur par défaut pour
// estFamiliale (absent doit rester NULL en base, jamais false).
describe("CreateSciDto — telephone/estFamiliale", () => {
  it("absents ne déclenchent aucune erreur", async () => {
    const dto = plainToInstance(CreateSciDto, { ...CHAMPS_VALIDES });
    const erreurs = await validate(dto);
    expect(erreurs).toHaveLength(0);
  });

  it("accepte telephone et estFamiliale à la création", async () => {
    const dto = plainToInstance(CreateSciDto, {
      ...CHAMPS_VALIDES,
      telephone: "0102030405",
      estFamiliale: true
    });
    const erreurs = await validate(dto);
    expect(erreurs).toHaveLength(0);
  });

  it("estFamiliale rejette une valeur non booléenne", async () => {
    const dto = plainToInstance(CreateSciDto, { ...CHAMPS_VALIDES, estFamiliale: "oui" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "estFamiliale")).toBe(true);
  });
});
