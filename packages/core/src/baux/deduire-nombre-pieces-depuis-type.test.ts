import { describe, expect, it } from "vitest";
import { deduireNombrePiecesDepuisType } from "./deduire-nombre-pieces-depuis-type";

describe("deduireNombrePiecesDepuisType", () => {
  it.each([
    ["T1", 1],
    ["T2", 2],
    ["T3", 3],
    ["T4", 4],
    ["T5", 5],
    ["T6", 6]
  ] as const)("%s -> %i pièce(s)", (type, attendu) => {
    expect(deduireNombrePiecesDepuisType(type)).toBe(attendu);
  });

  it("renvoie null pour un type inconnu plutôt que de deviner un nombre de pièces", () => {
    expect(deduireNombrePiecesDepuisType("T7")).toBeNull();
    expect(deduireNombrePiecesDepuisType("T5+")).toBeNull();
    expect(deduireNombrePiecesDepuisType("")).toBeNull();
  });
});
