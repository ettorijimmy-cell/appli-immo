import { describe, expect, it } from "vitest";
import { calculerAnnexe1, calculerForfaitLigne7 } from "./calculer-annexe1";

describe("calculerForfaitLigne7", () => {
  it("multiplie 20 € par le nombre de lots", () => {
    expect(calculerForfaitLigne7(3)).toBe("60.00");
  });

  it("retourne 0 pour un bien sans lot (garde-fou théorique)", () => {
    expect(calculerForfaitLigne7(0)).toBe("0.00");
  });
});

describe("calculerAnnexe1", () => {
  const automatiques = {
    ligne1: "12000.00",
    ligne6: "500.00",
    ligne8: "300.00",
    ligne9: "1200.00",
    ligne12: "800.00",
    ligne13: "600.00",
    ligne17: "2000.00",
    nombreLots: 2
  };

  it("calcule les lignes dérivées sans aucune saisie manuelle (toutes traitées comme 0)", () => {
    const resultat = calculerAnnexe1(automatiques);
    expect(resultat.ligne1).toBe("12000.00");
    expect(resultat.ligne5).toBe("12000.00");
    expect(resultat.ligne7).toBe("40.00");
    // 16 = 6+7+8+9+10+11+12+13-14+15 = 500+40+300+1200+0+0+800+600-0+0
    expect(resultat.ligne16).toBe("3440.00");
    // 18 = 5-16-17 = 12000-3440-2000
    expect(resultat.ligne18).toBe("6560.00");
    expect(resultat.ligne21).toBe("6560.00");
    expect(resultat.ligne23).toBe("6560.00");
  });

  it("intègre les lignes manuelles dans les totaux, sauf la ligne 9bis (mémo, jamais sommée)", () => {
    const resultat = calculerAnnexe1(automatiques, {
      ligne2: "100.00",
      ligne3: "50.00",
      ligne4: "25.00",
      ligne9Bis: "999.00",
      ligne10: "40.00",
      ligne11: "30.00",
      ligne14: "20.00",
      ligne15: "10.00",
      ligne19: "200.00",
      ligne20: "80.00",
      ligne22: "15.00"
    });
    // 5 = 1+2+3+4 = 12000+100+50+25
    expect(resultat.ligne5).toBe("12175.00");
    // 16 = 500+40+300+1200+40+30+800+600-20+10 = 3500.00
    expect(resultat.ligne16).toBe("3500.00");
    expect(resultat.ligne9Bis).toBe("999.00");
    // 18 = 12175-3500-2000 = 6675.00
    expect(resultat.ligne18).toBe("6675.00");
    // 21 = 18+19-20 = 6675+200-80 = 6795.00
    expect(resultat.ligne21).toBe("6795.00");
    // 23 = 21+22 = 6795+15 = 6810.00
    expect(resultat.ligne23).toBe("6810.00");
  });

  it("traite un champ manuel vide ou une chaîne vide comme 0, jamais une erreur", () => {
    const resultat = calculerAnnexe1(automatiques, { ligne2: "", ligne3: null, ligne4: undefined });
    expect(resultat.ligne5).toBe("12000.00");
  });

  it("gère un résultat net négatif (ligne 18 déficitaire) sans erreur d'arrondi", () => {
    const resultat = calculerAnnexe1({
      ligne1: "1000.00",
      ligne6: "500.00",
      ligne8: "300.00",
      ligne9: "5000.00",
      ligne12: "800.00",
      ligne13: "600.00",
      ligne17: "2000.00",
      nombreLots: 1
    });
    // 16 = 500+20+300+5000+0+0+800+600-0+0 = 7220.00
    expect(resultat.ligne16).toBe("7220.00");
    // 18 = 1000-7220-2000 = -8220.00
    expect(resultat.ligne18).toBe("-8220.00");
    expect(resultat.ligne23).toBe("-8220.00");
  });
});
