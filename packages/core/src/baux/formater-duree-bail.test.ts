import { describe, expect, it } from "vitest";
import { formaterDureeBail } from "./formater-duree-bail";

describe("formaterDureeBail", () => {
  it("36 mois -> 3 ans", () => {
    expect(formaterDureeBail(36)).toBe("3 ans");
  });

  it("72 mois -> 6 ans", () => {
    expect(formaterDureeBail(72)).toBe("6 ans");
  });

  it("12 mois -> 1 an (singulier)", () => {
    expect(formaterDureeBail(12)).toBe("1 an");
  });

  it("9 mois -> 9 mois (non multiple de 12)", () => {
    expect(formaterDureeBail(9)).toBe("9 mois");
  });
});
