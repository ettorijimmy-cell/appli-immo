import { describe, expect, it } from "vitest";
import {
  validerCompletudeGenerationQuittance,
  type DonneesCompletudeQuittance
} from "./valider-completude-generation-quittance";

const DONNEES_COMPLETES: DonneesCompletudeQuittance = {
  nomBailleur: "SCI Test",
  nomLocataire: "Jean Dupont",
  libelleBien: "1 rue de Test — n°1",
  periode: "juin 2026",
  loyerHorsCharges: "700.00",
  charges: "100.00",
  dateReglement: "2026-06-05",
  villeEmission: "Paris"
};

describe("validerCompletudeGenerationQuittance", () => {
  it("ne renvoie aucun champ manquant quand tout est renseigné", () => {
    expect(validerCompletudeGenerationQuittance(DONNEES_COMPLETES)).toEqual([]);
  });

  it("signale chaque champ manquant séparément", () => {
    const manquants = validerCompletudeGenerationQuittance({
      nomBailleur: null,
      nomLocataire: null,
      libelleBien: null,
      periode: null,
      loyerHorsCharges: null,
      charges: null,
      dateReglement: null,
      villeEmission: null
    });
    expect(manquants).toHaveLength(8);
  });

  it("signale loyerHorsCharges/charges manquants séparément (échéance figée absente)", () => {
    const manquants = validerCompletudeGenerationQuittance({
      ...DONNEES_COMPLETES,
      loyerHorsCharges: null,
      charges: null
    });
    expect(manquants).toContain("Montant du loyer hors charges (échéance antérieure au 2026-08-31 ?)");
    expect(manquants).toContain("Montant des charges (échéance antérieure au 2026-08-31 ?)");
  });
});
