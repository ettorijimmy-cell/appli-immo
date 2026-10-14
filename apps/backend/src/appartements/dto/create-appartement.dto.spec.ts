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
// normalisation virgule/point contrairement à depense.montant). Rejet du
// signe négatif ajouté au Sous-commit D (revue financial-logic-reviewer,
// 2026-10-02) : tantieme/surface servent de poids à
// repartirProportionnellement (packages/core), une valeur négative
// fausserait silencieusement le calcul des parts de tous les lots.
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

  it("rejette une valeur négative", async () => {
    const dto = plainToInstance(CreateAppartementDto, { ...CHAMPS_VALIDES, tantieme: "-125.50" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "tantieme")).toBe(true);
  });

  it("rejette une surface négative", async () => {
    const dto = plainToInstance(CreateAppartementDto, { ...CHAMPS_VALIDES, surface: "-45.00" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "surface")).toBe(true);
  });
});

describe("CreateAppartementDto — numero", () => {
  it("vide est rejeté (MinLength(1))", async () => {
    const dto = plainToInstance(CreateAppartementDto, { ...CHAMPS_VALIDES, numero: "" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "numero")).toBe(true);
  });
});

// Point 6c (docs/backlog.md) : equipementCuisine/dependancesAnnexes
// (exigés par validerCompletudeGenerationBail) et les 5 champs de
// composition du logement (module État des lieux) manquaient jusqu'ici
// entièrement à la création.
describe("CreateAppartementDto — composition du lot", () => {
  it("accepte les 7 nouveaux champs à la création", async () => {
    const dto = plainToInstance(CreateAppartementDto, {
      ...CHAMPS_VALIDES,
      equipementCuisine: "Plaques + four",
      dependancesAnnexes: "Cave",
      nombreChambres: 2,
      nombreSallesDeBain: 1,
      nombreWc: 1,
      autrePiece1: "Bureau",
      autrePiece2: "Dressing"
    });
    const erreurs = await validate(dto);
    expect(erreurs).toHaveLength(0);
  });

  it("absents ne déclenchent aucune erreur", async () => {
    const dto = plainToInstance(CreateAppartementDto, { ...CHAMPS_VALIDES });
    const erreurs = await validate(dto);
    expect(erreurs).toHaveLength(0);
  });

  it("nombreChambres hors bornes (max 3) est rejeté", async () => {
    const dto = plainToInstance(CreateAppartementDto, { ...CHAMPS_VALIDES, nombreChambres: 4 });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "nombreChambres")).toBe(true);
  });

  it("nombreSallesDeBain hors bornes (max 2) est rejeté", async () => {
    const dto = plainToInstance(CreateAppartementDto, { ...CHAMPS_VALIDES, nombreSallesDeBain: 3 });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "nombreSallesDeBain")).toBe(true);
  });

  it("nombreChambres = 0 est accepté (studio sans chambre séparée)", async () => {
    const dto = plainToInstance(CreateAppartementDto, { ...CHAMPS_VALIDES, nombreChambres: 0 });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "nombreChambres")).toBe(false);
  });
});
