import { describe, expect, it } from "vitest";
import { dateDuJourParis } from "./date-paris";

describe("dateDuJourParis", () => {
  it("renvoie une date différente de la date UTC autour de minuit, heure d'hiver (Paris = UTC+1)", () => {
    // 23h30 UTC le 15 janvier correspond à 00h30 le 16 janvier à Paris
    // (CET, UTC+1 en janvier) — une erreur classique de toISOString()
    // donnerait encore "2026-01-15".
    const referenceUtc = new Date("2026-01-15T23:30:00Z");
    expect(referenceUtc.toISOString().slice(0, 10)).toBe("2026-01-15");
    expect(dateDuJourParis(referenceUtc)).toBe("2026-01-16");
  });

  it("renvoie une date différente de la date UTC autour de minuit, heure d'été (Paris = UTC+2)", () => {
    // 22h30 UTC le 15 juillet correspond à 00h30 le 16 juillet à Paris
    // (CEST, UTC+2 en juillet).
    const referenceUtc = new Date("2026-07-15T22:30:00Z");
    expect(referenceUtc.toISOString().slice(0, 10)).toBe("2026-07-15");
    expect(dateDuJourParis(referenceUtc)).toBe("2026-07-16");
  });

  it("renvoie la même date que UTC en pleine journée (aucun décalage de jour possible)", () => {
    const referenceUtc = new Date("2026-03-10T12:00:00Z");
    expect(dateDuJourParis(referenceUtc)).toBe("2026-03-10");
  });

  it("format toujours YYYY-MM-DD, y compris mois/jour sur un seul chiffre", () => {
    const referenceUtc = new Date("2026-01-05T10:00:00Z");
    expect(dateDuJourParis(referenceUtc)).toBe("2026-01-05");
  });
});
