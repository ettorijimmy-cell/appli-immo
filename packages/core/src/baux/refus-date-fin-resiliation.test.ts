import { describe, expect, it } from "vitest";
import { MESSAGE_DATE_FIN_RESILIATION_FUTURE, refusDateFinResiliation } from "./refus-date-fin-resiliation";

describe("refusDateFinResiliation", () => {
  it("refuse une date de fin dans le futur, avec le message exact", () => {
    expect(refusDateFinResiliation("2026-11-14", "2026-11-13")).toBe("Résiliez le bail à la date de départ ou après.");
    expect(MESSAGE_DATE_FIN_RESILIATION_FUTURE).toBe("Résiliez le bail à la date de départ ou après.");
  });

  it("accepte la date du jour", () => {
    expect(refusDateFinResiliation("2026-11-13", "2026-11-13")).toBeNull();
  });

  it("accepte une date passée", () => {
    expect(refusDateFinResiliation("2026-09-15", "2026-11-13")).toBeNull();
  });

  it("ne compare que la partie date d'un horodatage ISO complet", () => {
    expect(refusDateFinResiliation("2026-11-13T23:30:00.000Z", "2026-11-13")).toBeNull();
    expect(refusDateFinResiliation("2026-11-14T00:00:00.000Z", "2026-11-13")).not.toBeNull();
  });

  it("change d'année et de mois correctement (comparaison ISO)", () => {
    expect(refusDateFinResiliation("2027-01-01", "2026-12-31")).not.toBeNull();
    expect(refusDateFinResiliation("2026-12-31", "2027-01-01")).toBeNull();
  });
});
