import { describe, expect, it } from "vitest";
import { calculerFormulaire2044 } from "./calculer-2044";

describe("calculerFormulaire2044", () => {
  it("calcule 215/240/261/263 à partir des 4 lignes automatiques", () => {
    const resultat = calculerFormulaire2044({
      ligne211: "12000.00",
      ligne221: "300.00",
      ligne223: "250.00",
      ligne224: "1500.00",
      ligne227: "800.00"
    });

    expect(resultat.ligne211).toBe("12000.00");
    expect(resultat.ligne212).toBe("0.00");
    expect(resultat.ligne213).toBe("0.00");
    // 215 = 211+212+213 = 12000+0+0
    expect(resultat.ligne215).toBe("12000.00");
    // 240 = 221+223+224+227 = 300+250+1500+800
    expect(resultat.ligne240).toBe("2850.00");
    // 261 = 215-240 = 12000-2850
    expect(resultat.ligne261).toBe("9150.00");
    expect(resultat.ligne263).toBe("9150.00");
  });

  it("gère un résultat déficitaire (240 > 215) sans erreur d'arrondi", () => {
    const resultat = calculerFormulaire2044({
      ligne211: "1000.00",
      ligne221: "300.00",
      ligne223: "250.00",
      ligne224: "5000.00",
      ligne227: "800.00"
    });

    // 240 = 300+250+5000+800 = 6350.00
    expect(resultat.ligne240).toBe("6350.00");
    // 261 = 1000-6350 = -5350.00
    expect(resultat.ligne261).toBe("-5350.00");
    expect(resultat.ligne263).toBe("-5350.00");
  });

  it("retourne 0 partout sans aucune donnée", () => {
    const resultat = calculerFormulaire2044({
      ligne211: "0.00",
      ligne221: "0.00",
      ligne223: "0.00",
      ligne224: "0.00",
      ligne227: "0.00"
    });

    expect(resultat.ligne215).toBe("0.00");
    expect(resultat.ligne240).toBe("0.00");
    expect(resultat.ligne261).toBe("0.00");
    expect(resultat.ligne263).toBe("0.00");
  });
});
