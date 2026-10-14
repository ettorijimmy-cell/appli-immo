import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { UpdateLocataireDto } from "./update-locataire.dto";

// Point 6b (docs/backlog.md) : email/telephone/adresse/codePostal/ville/
// dateNaissance doivent accepter `null` (champ à effacer, voir
// EditLocataireForm desktop) aussi bien que `undefined` (clé absente,
// champ non modifié) — même raisonnement que UpdateGarantDto (f3513de).
// nom/prenom restent non vidables (jamais `| null`).
describe("UpdateLocataireDto", () => {
  it("nom vide est rejeté (MinLength(1))", async () => {
    const dto = plainToInstance(UpdateLocataireDto, { nom: "" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "nom")).toBe(true);
  });

  it("nom absent (non fourni) ne déclenche aucune erreur", async () => {
    const dto = plainToInstance(UpdateLocataireDto, {});
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "nom")).toBe(false);
  });

  for (const champ of ["email", "telephone", "adresse", "codePostal", "ville", "dateNaissance"]) {
    it(`${champ} accepte null (champ à effacer)`, async () => {
      const dto = plainToInstance(UpdateLocataireDto, { [champ]: null });
      const erreurs = await validate(dto);
      expect(erreurs.some((e) => e.property === champ)).toBe(false);
    });

    it(`${champ} absent (non fourni) ne déclenche aucune erreur`, async () => {
      const dto = plainToInstance(UpdateLocataireDto, {});
      const erreurs = await validate(dto);
      expect(erreurs.some((e) => e.property === champ)).toBe(false);
    });
  }

  it("email invalide (non vide, mal formé) reste rejeté malgré le typage nullable", async () => {
    const dto = plainToInstance(UpdateLocataireDto, { email: "pas-un-email" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "email")).toBe(true);
  });

  it("dateNaissance invalide (non vide, mal formée) reste rejetée malgré le typage nullable", async () => {
    const dto = plainToInstance(UpdateLocataireDto, { dateNaissance: "pas-une-date" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "dateNaissance")).toBe(true);
  });

  it("statut accepte les 2 valeurs modifiables", async () => {
    for (const valeur of ["actif", "ancien"]) {
      const dto = plainToInstance(UpdateLocataireDto, { statut: valeur });
      const erreurs = await validate(dto);
      expect(erreurs.some((e) => e.property === "statut")).toBe(false);
    }
  });

  it("statut rejette une valeur hors enum (archive exclu, endpoint dédié)", async () => {
    const dto = plainToInstance(UpdateLocataireDto, { statut: "archive" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "statut")).toBe(true);
  });
});
