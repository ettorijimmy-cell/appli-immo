import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { UpdateGarantDto } from "./update-garant.dto";

// Point 6a (docs/backlog.md) : dateNaissance/lieuNaissance/nationalite
// doivent accepter `null` (champ à effacer, voir EditGarantForm desktop)
// aussi bien que `undefined` (clé absente, champ non modifié) — @IsOptional()
// de class-validator saute la validation dans les deux cas, contrairement à
// une simple chaîne vide qui resterait soumise aux validateurs (@IsEmail,
// @IsDateString...).
describe("UpdateGarantDto", () => {
  it("nom vide est rejeté (MinLength(1))", async () => {
    const dto = plainToInstance(UpdateGarantDto, { nom: "" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "nom")).toBe(true);
  });

  it("nom absent (non fourni) ne déclenche aucune erreur", async () => {
    const dto = plainToInstance(UpdateGarantDto, {});
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "nom")).toBe(false);
  });

  for (const champ of ["email", "telephone", "dateNaissance", "lieuNaissance", "nationalite"]) {
    it(`${champ} accepte null (champ à effacer)`, async () => {
      const dto = plainToInstance(UpdateGarantDto, { [champ]: null });
      const erreurs = await validate(dto);
      expect(erreurs.some((e) => e.property === champ)).toBe(false);
    });

    it(`${champ} absent (non fourni) ne déclenche aucune erreur`, async () => {
      const dto = plainToInstance(UpdateGarantDto, {});
      const erreurs = await validate(dto);
      expect(erreurs.some((e) => e.property === champ)).toBe(false);
    });
  }

  it("email invalide (non vide, mal formé) reste rejeté malgré le typage nullable", async () => {
    const dto = plainToInstance(UpdateGarantDto, { email: "pas-un-email" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "email")).toBe(true);
  });

  it("dateNaissance invalide (non vide, mal formée) reste rejetée malgré le typage nullable", async () => {
    const dto = plainToInstance(UpdateGarantDto, { dateNaissance: "pas-une-date" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "dateNaissance")).toBe(true);
  });

  it("typeGarantie accepte les 3 valeurs valides", async () => {
    for (const valeur of ["personne_physique", "garantie_visale", "autre"]) {
      const dto = plainToInstance(UpdateGarantDto, { typeGarantie: valeur });
      const erreurs = await validate(dto);
      expect(erreurs.some((e) => e.property === "typeGarantie")).toBe(false);
    }
  });

  it("typeGarantie rejette une valeur hors enum", async () => {
    const dto = plainToInstance(UpdateGarantDto, { typeGarantie: "autre_chose" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "typeGarantie")).toBe(true);
  });
});
