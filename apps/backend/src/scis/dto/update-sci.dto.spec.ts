import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { UpdateSciDto } from "./update-sci.dto";

// Point 6d (docs/backlog.md) : telephone/estFamiliale doivent accepter
// `null` (champ à effacer / remettre à "Non renseigné", voir EditSciForm
// desktop) aussi bien que `undefined` (clé absente, champ non modifié).
// nom/regimeFiscal restent non vidables (@ValidateIf, pas @IsOptional) —
// même raisonnement que numero sur UpdateAppartementDto (point 6c) et
// nom/prenom sur UpdateLocataireDto/UpdateGarantDto (commit 99169d2).
describe("UpdateSciDto — nom/regimeFiscal", () => {
  it("nom vide est rejeté (MinLength(1))", async () => {
    const dto = plainToInstance(UpdateSciDto, { nom: "" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "nom")).toBe(true);
  });

  it("nom absent (non fourni) ne déclenche aucune erreur", async () => {
    const dto = plainToInstance(UpdateSciDto, {});
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "nom")).toBe(false);
  });

  it("nom null est rejeté — jamais effaçable", async () => {
    const dto = plainToInstance(UpdateSciDto, { nom: null });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "nom")).toBe(true);
  });

  it("regimeFiscal absent (non fourni) ne déclenche aucune erreur", async () => {
    const dto = plainToInstance(UpdateSciDto, {});
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "regimeFiscal")).toBe(false);
  });

  it("regimeFiscal null est rejeté — jamais effaçable", async () => {
    const dto = plainToInstance(UpdateSciDto, { regimeFiscal: null });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "regimeFiscal")).toBe(true);
  });
});

describe("UpdateSciDto — telephone/estFamiliale (null accepté)", () => {
  for (const champ of ["telephone", "estFamiliale"]) {
    it(`${champ} accepte null (champ à effacer)`, async () => {
      const dto = plainToInstance(UpdateSciDto, { [champ]: null });
      const erreurs = await validate(dto);
      expect(erreurs.some((e) => e.property === champ)).toBe(false);
    });

    it(`${champ} absent (non fourni) ne déclenche aucune erreur`, async () => {
      const dto = plainToInstance(UpdateSciDto, {});
      const erreurs = await validate(dto);
      expect(erreurs.some((e) => e.property === champ)).toBe(false);
    });
  }

  it("estFamiliale accepte true/false", async () => {
    for (const valeur of [true, false]) {
      const dto = plainToInstance(UpdateSciDto, { estFamiliale: valeur });
      const erreurs = await validate(dto);
      expect(erreurs.some((e) => e.property === "estFamiliale")).toBe(false);
    }
  });

  it("estFamiliale invalide (non null, mal formé) reste rejeté malgré le typage nullable", async () => {
    const dto = plainToInstance(UpdateSciDto, { estFamiliale: "oui" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "estFamiliale")).toBe(true);
  });
});
