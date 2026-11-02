import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { SubmitClesDto } from "./submit-cles.dto";
import { SubmitEquipementsDiversDto } from "./submit-equipements-divers.dto";
import { SubmitInventaireDto } from "./submit-inventaire.dto";
import { SubmitPieceAutreDto } from "./submit-piece-autre.dto";
import { SubmitPieceChambreDto } from "./submit-piece-chambre.dto";
import { SubmitPieceCuisineDto } from "./submit-piece-cuisine.dto";
import { SubmitPieceEntreeDto } from "./submit-piece-entree.dto";
import { SubmitPieceSalleDeBainDto } from "./submit-piece-salle-de-bain.dto";
import { SubmitPieceSejourDto } from "./submit-piece-sejour.dto";
import { SubmitPieceWcDto } from "./submit-piece-wc.dto";

const ELEMENT = "018f1e3a-0000-7000-8000-000000000001";

describe.each([
  ["entrée", SubmitPieceEntreeDto, {}],
  ["séjour", SubmitPieceSejourDto, {}],
  ["cuisine", SubmitPieceCuisineDto, {}],
  ["chambre", SubmitPieceChambreDto, { numero: 1 }],
  ["salle de bain", SubmitPieceSalleDeBainDto, { numero: 1 }],
  ["WC", SubmitPieceWcDto, { numero: 1 }],
  ["autre pièce", SubmitPieceAutreDto, { numero: 1, libelle: "Cellier" }]
])("observations de sortie, pièce %s", (_nom, Dto, base) => {
  async function valider(observationsSortie: unknown) {
    const dto = plainToInstance(Dto as new () => { observationsSortie?: string | null }, { ...base, observationsSortie });
    return { dto, erreurs: await validate(dto) };
  }

  it("accepte 500 caractères, refuse 501", async () => {
    expect((await valider("a".repeat(500))).erreurs).toHaveLength(0);
    expect((await valider("a".repeat(501))).erreurs.map((e) => e.property)).toEqual(["observationsSortie"]);
  });

  it("nettoie le texte, et compte la longueur après nettoyage", async () => {
    const { dto, erreurs } = await valider(`  ${"a".repeat(500)}  `);

    expect(erreurs).toHaveLength(0);
    expect(dto.observationsSortie).toBe("a".repeat(500));
  });

  it("une saisie blanche devient null, un champ absent reste absent", async () => {
    expect((await valider("   ")).dto.observationsSortie).toBeNull();
    expect((await valider(undefined)).dto.observationsSortie).toBeUndefined();
  });

  it("refuse une valeur qui n'est pas du texte", async () => {
    expect((await valider(12)).erreurs.map((e) => e.property)).toEqual(["observationsSortie"]);
  });
});

describe.each([
  ["clés", SubmitClesDto, { typeCle: "immeuble" }],
  ["équipements divers", SubmitEquipementsDiversDto, { libelle: "Aspirateur" }],
  ["inventaire", SubmitInventaireDto, { elementId: ELEMENT }]
])("commentaire de sortie, %s", (_nom, Dto, ligne) => {
  async function valider(commentaireSortie: unknown) {
    const dto = plainToInstance(Dto as new () => { lignes: { commentaireSortie?: string | null }[] }, {
      lignes: [{ ...ligne, commentaireSortie }]
    });
    return { dto, erreurs: await validate(dto) };
  }

  it("accepte 500 caractères, refuse 501", async () => {
    expect((await valider("a".repeat(500))).erreurs).toHaveLength(0);
    expect((await valider("a".repeat(501))).erreurs.map((e) => e.property)).toEqual(["lignes"]);
  });

  it("nettoie le texte", async () => {
    expect((await valider("  Clé tordue\r\n")).dto.lignes[0]?.commentaireSortie).toBe("Clé tordue");
  });
});
