import { describe, expect, it } from "vitest";
import { calculerLoyerPrecedentLocataire } from "./calculer-loyer-precedent-locataire";

describe("calculerLoyerPrecedentLocataire", () => {
  it("retourne null si aucun bail précédent", () => {
    expect(calculerLoyerPrecedentLocataire(null, "2026-09-01")).toBeNull();
  });

  it("retourne null si le bail précédent n'a pas de date_fin", () => {
    expect(
      calculerLoyerPrecedentLocataire({ loyerMensuel: "800.00", dateFin: null }, "2026-09-01")
    ).toBeNull();
  });

  it("retourne null si le bail précédent n'a pas de loyer_mensuel", () => {
    expect(
      calculerLoyerPrecedentLocataire({ loyerMensuel: null, dateFin: "2026-08-01" }, "2026-09-01")
    ).toBeNull();
  });

  it("retourne le loyer si le départ remonte à moins de 18 mois", () => {
    expect(
      calculerLoyerPrecedentLocataire({ loyerMensuel: "800.00", dateFin: "2026-08-01" }, "2026-09-01")
    ).toBe("800.00");
  });

  it("retourne le loyer à exactement 17 mois d'écart", () => {
    expect(
      calculerLoyerPrecedentLocataire({ loyerMensuel: "800.00", dateFin: "2025-04-01" }, "2026-09-01")
    ).toBe("800.00");
  });

  it("retourne null à exactement 18 mois d'écart (seuil exclusif)", () => {
    expect(
      calculerLoyerPrecedentLocataire({ loyerMensuel: "800.00", dateFin: "2025-03-01" }, "2026-09-01")
    ).toBeNull();
  });

  it("retourne null au-delà de 18 mois", () => {
    expect(
      calculerLoyerPrecedentLocataire({ loyerMensuel: "800.00", dateFin: "2024-01-01" }, "2026-09-01")
    ).toBeNull();
  });
});
