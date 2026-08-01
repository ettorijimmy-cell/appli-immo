import { describe, expect, it } from "vitest";
import { irlEstPerime } from "./valider-fraicheur-irl";

describe("irlEstPerime", () => {
  it("n'est pas périmé juste en dessous du seuil de 4 mois", () => {
    expect(irlEstPerime("2026-01-15", "2026-05-14")).toBe(false);
  });

  it("est périmé exactement à 4 mois révolus", () => {
    expect(irlEstPerime("2026-01-15", "2026-05-15")).toBe(false);
    expect(irlEstPerime("2026-01-15", "2026-05-16")).toBe(true);
  });

  it("n'est pas périmé le jour même de la récupération", () => {
    expect(irlEstPerime("2026-07-01", "2026-07-01")).toBe(false);
  });

  it("est franchement périmé après un long silence du job", () => {
    expect(irlEstPerime("2025-01-01", "2026-07-01")).toBe(true);
  });
});
