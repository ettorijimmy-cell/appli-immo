import { describe, expect, it } from "vitest";
import { calculerStatutDocument } from "./calculer-statut-document";

describe("calculerStatutDocument", () => {
  it("retourne valide si aucune date d'expiration", () => {
    expect(calculerStatutDocument(null, false, "2026-07-28")).toBe("valide");
  });

  it("retourne valide le jour même de l'expiration (expire en fin de journée)", () => {
    expect(calculerStatutDocument("2026-07-28", false, "2026-07-28")).toBe("valide");
  });

  it("retourne valide tant que la date de référence précède la date d'expiration", () => {
    expect(calculerStatutDocument("2026-07-28", false, "2026-07-27")).toBe("valide");
  });

  it("retourne expire dès le lendemain de la date d'expiration", () => {
    expect(calculerStatutDocument("2026-07-28", false, "2026-07-29")).toBe("expire");
  });

  it("retourne expire largement après la date d'expiration", () => {
    expect(calculerStatutDocument("2026-01-01", false, "2026-07-28")).toBe("expire");
  });

  it("retourne archive même si la date d'expiration est dépassée", () => {
    expect(calculerStatutDocument("2026-01-01", true, "2026-07-28")).toBe("archive");
  });

  it("retourne archive même sans date d'expiration", () => {
    expect(calculerStatutDocument(null, true, "2026-07-28")).toBe("archive");
  });
});
