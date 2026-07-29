import { describe, expect, it } from "vitest";
import { calculerLoyerNetRecuEcheance, calculerProvisionsRecuesEcheance } from "./calculer-provisions-recues";

describe("calculerProvisionsRecuesEcheance", () => {
  it("cas nominal : échéance pleine payée intégralement", () => {
    expect(calculerProvisionsRecuesEcheance("800.00", "750.00", "50.00")).toBe("50.00");
  });

  it("retourne 0 si aucune provision sur le bail (null)", () => {
    expect(calculerProvisionsRecuesEcheance("750.00", "750.00", null)).toBe("0.00");
  });

  it("retourne 0 si provisions_charges vaut explicitement 0", () => {
    expect(calculerProvisionsRecuesEcheance("750.00", "750.00", "0.00")).toBe("0.00");
  });

  it("échéance proratisée (mois partiel) : proportion conservée sur le montant réellement dû", () => {
    // Mois plein = 900 loyer + 100 provisions = 1000 ; échéance proratisée
    // à moitié du mois (500.00) : la part provisions doit rester à 10% de
    // ce montant réduit, pas 100.00 (le forfait mensuel plein).
    expect(calculerProvisionsRecuesEcheance("500.00", "900.00", "100.00")).toBe("50.00");
  });

  it("paiement partiel : la part provisions est calculée sur le montant réellement reçu, pas sur le montant dû", () => {
    // Mois plein dû = 1000 (900 + 100), mais seul 400 a été reçu (partiel) :
    // la part provisions correspondante est 400 x 100/1000 = 40, jamais
    // 100 (qui supposerait le mois intégralement réglé).
    expect(calculerProvisionsRecuesEcheance("400.00", "900.00", "100.00")).toBe("40.00");
  });

  it("tronque au centime, jamais d'arrondi flottant", () => {
    // 100 x 33.33.../100 -> vérifie la troncature entière en centimes.
    expect(calculerProvisionsRecuesEcheance("100.00", "200.00", "100.00")).toBe("33.33");
  });
});

describe("calculerLoyerNetRecuEcheance", () => {
  it("cas nominal : soustrait exactement la part provisions", () => {
    expect(calculerLoyerNetRecuEcheance("800.00", "750.00", "50.00")).toBe("750.00");
  });

  it("retourne le montant reçu en entier si aucune provision", () => {
    expect(calculerLoyerNetRecuEcheance("750.00", "750.00", null)).toBe("750.00");
  });

  it("échéance proratisée : la part loyer suit la même proportion que le montant réduit", () => {
    expect(calculerLoyerNetRecuEcheance("500.00", "900.00", "100.00")).toBe("450.00");
  });

  it("paiement partiel : la part loyer est calculée sur ce qui a été reçu", () => {
    expect(calculerLoyerNetRecuEcheance("400.00", "900.00", "100.00")).toBe("360.00");
  });

  it("loyerNet + provisions reconstitue exactement le montant reçu, y compris sur un cas non exact (33.33)", () => {
    const montantRecu = "100.00";
    const loyerNet = calculerLoyerNetRecuEcheance(montantRecu, "200.00", "100.00");
    const provisions = calculerProvisionsRecuesEcheance(montantRecu, "200.00", "100.00");
    expect((Number(loyerNet) + Number(provisions)).toFixed(2)).toBe(montantRecu);
  });
});
