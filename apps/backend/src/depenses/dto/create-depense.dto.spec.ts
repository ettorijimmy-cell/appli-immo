import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreateDepenseDto } from "./create-depense.dto";

const CHAMPS_VALIDES = {
  categorie: "reparation_entretien",
  dateDepense: "2026-09-01",
  libelle: "Plomberie",
  bienId: "018f1a1e-0000-7000-8000-000000000000"
};

// Garde-fou ajouté suite à la revue financial-logic-reviewer (2026-09-07) :
// une ligne de débit importée via parserReleveCsv (packages/core) est
// signée négative (convention du rapprochement bancaire), incompatible
// avec depense.montant qui doit toujours être positif — le frontend
// applique déjà valeurAbsolueMontant avant l'appel, ce test vérifie que le
// DTO rejette lui aussi tout appelant qui ne le ferait pas.
describe("CreateDepenseDto — montant", () => {
  it("rejette un montant négatif", async () => {
    const dto = plainToInstance(CreateDepenseDto, { ...CHAMPS_VALIDES, montant: "-450.00" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "montant")).toBe(true);
  });

  it("accepte un montant positif à virgule décimale (normalisé en point)", async () => {
    const dto = plainToInstance(CreateDepenseDto, { ...CHAMPS_VALIDES, montant: "450,00" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "montant")).toBe(false);
    expect(dto.montant).toBe("450.00");
  });

  it("accepte un montant entier sans décimale", async () => {
    const dto = plainToInstance(CreateDepenseDto, { ...CHAMPS_VALIDES, montant: "450" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "montant")).toBe(false);
  });
});
