import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { UpdateAppartementDto } from "./update-appartement.dto";

// Point 6c (docs/backlog.md) : la plupart des champs optionnels doivent
// accepter `null` (champ à effacer, voir EditAppartementForm desktop) aussi
// bien que `undefined` (clé absente, champ non modifié) — même raisonnement
// que UpdateGarantDto/UpdateLocataireDto (f3513de, 4faa41d).
//
// numero est l'exception : @ValidateIf (pas @IsOptional) pour qu'un `null`
// explicite soit réellement rejeté par @IsString/@MinLength, plutôt que
// traité comme "absent" et laissé passer sans validation (comportement par
// défaut de @IsOptional() face à `null`, vérifié empiriquement en amont de
// cette implémentation).
describe("UpdateAppartementDto — numero", () => {
  it("vide est rejeté (MinLength(1))", async () => {
    const dto = plainToInstance(UpdateAppartementDto, { numero: "" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "numero")).toBe(true);
  });

  it("absent (non fourni) ne déclenche aucune erreur", async () => {
    const dto = plainToInstance(UpdateAppartementDto, {});
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "numero")).toBe(false);
  });

  it("null est rejeté — jamais effaçable, contrairement aux autres champs optionnels", async () => {
    const dto = plainToInstance(UpdateAppartementDto, { numero: null });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "numero")).toBe(true);
  });
});

describe("UpdateAppartementDto — champs nullables", () => {
  const CHAMPS_NULLABLES = [
    "surface",
    "tantieme",
    "loyerReference",
    "equipementCuisine",
    "dependancesAnnexes",
    "typeEnergie",
    "nombreChambres",
    "nombreSallesDeBain",
    "nombreWc",
    "autrePiece1",
    "autrePiece2",
    "classeDpe",
    "depensesEnergieMin",
    "depensesEnergieMax",
    "anneeReferencePrixEnergie"
  ];

  for (const champ of CHAMPS_NULLABLES) {
    it(`${champ} accepte null (champ à effacer)`, async () => {
      const dto = plainToInstance(UpdateAppartementDto, { [champ]: null });
      const erreurs = await validate(dto);
      expect(erreurs.some((e) => e.property === champ)).toBe(false);
    });

    it(`${champ} absent (non fourni) ne déclenche aucune erreur`, async () => {
      const dto = plainToInstance(UpdateAppartementDto, {});
      const erreurs = await validate(dto);
      expect(erreurs.some((e) => e.property === champ)).toBe(false);
    });
  }

  it("surface invalide (non vide, mal formée) reste rejetée malgré le typage nullable", async () => {
    const dto = plainToInstance(UpdateAppartementDto, { surface: "abc" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "surface")).toBe(true);
  });
});

// type/nombrePiecesPrincipales/modeChauffage/modeEauChaude : `null` est
// syntaxiquement accepté au niveau du DTO (sinon AppartementsService ne
// pourrait jamais distinguer "absent" de "explicitement effacé" pour
// rejeter ce dernier cas sur un bien résidentiel) — la règle "jamais
// effaçable pour un résidentiel" est vérifiée côté service, pas ici (elle
// dépend du bienId, inconnu du DTO). Voir
// appartements-composition.integration.spec.ts pour la vérification
// bout-en-bout.
describe("UpdateAppartementDto — champs requis-si-résidentiel (null accepté au niveau DTO)", () => {
  for (const champ of ["type", "nombrePiecesPrincipales", "modeChauffage", "modeEauChaude"]) {
    it(`${champ} accepte null au niveau DTO (rejeté plus loin par le service si résidentiel)`, async () => {
      const dto = plainToInstance(UpdateAppartementDto, { [champ]: null });
      const erreurs = await validate(dto);
      expect(erreurs.some((e) => e.property === champ)).toBe(false);
    });
  }
});

describe("UpdateAppartementDto — statut", () => {
  it("accepte les 3 valeurs modifiables", async () => {
    for (const valeur of ["vacant", "loue", "travaux"]) {
      const dto = plainToInstance(UpdateAppartementDto, { statut: valeur });
      const erreurs = await validate(dto);
      expect(erreurs.some((e) => e.property === "statut")).toBe(false);
    }
  });

  it("rejette une valeur hors enum (archive exclu, endpoint dédié)", async () => {
    const dto = plainToInstance(UpdateAppartementDto, { statut: "archive" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "statut")).toBe(true);
  });
});
