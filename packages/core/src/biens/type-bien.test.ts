import { describe, expect, it } from "vitest";
import { estTypeResidentiel, type TypeBien } from "./type-bien";

describe("estTypeResidentiel", () => {
  it.each<[TypeBien, boolean]>([
    ["immeuble", true],
    ["maison", true],
    ["appartement_isole", true],
    ["parking", false],
    ["bureau", false],
    ["local_commercial", false]
  ])("%s -> %s", (type, attendu) => {
    expect(estTypeResidentiel(type)).toBe(attendu);
  });
});
