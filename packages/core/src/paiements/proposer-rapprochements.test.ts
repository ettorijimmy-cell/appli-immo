import { describe, expect, it } from "vitest";
import { proposerRapprochements } from "./proposer-rapprochements";

describe("proposerRapprochements", () => {
  it("propose un candidat unique correspondant sur les trois critères", () => {
    const propositions = proposerRapprochements(
      [{ id: "ligne-1", date: "2026-08-05", montant: "850.00", libelle: "VIR DUPONT LOYER AOUT" }],
      [{ id: "paiement-1", montant: "850.00", dateEcheance: "2026-08-01", nomsLocataires: ["Dupont", "Alice"] }]
    );

    expect(propositions).toEqual([
      {
        ligneCsvId: "ligne-1",
        candidats: [{ paiementId: "paiement-1", criteresCorrespondants: ["montant", "date", "reference"] }]
      }
    ]);
  });

  it("propose quand même un candidat unique si aucun nom ne correspond (montant+date seuls)", () => {
    const propositions = proposerRapprochements(
      [{ id: "ligne-1", date: "2026-08-05", montant: "850.00", libelle: "VIREMENT SEPA 123456" }],
      [{ id: "paiement-1", montant: "850.00", dateEcheance: "2026-08-01", nomsLocataires: ["Dupont", "Alice"] }]
    );

    expect(propositions).toEqual([
      {
        ligneCsvId: "ligne-1",
        candidats: [{ paiementId: "paiement-1", criteresCorrespondants: ["montant", "date"] }]
      }
    ]);
  });

  it("présente TOUS les candidats en cas d'ambiguïté (même montant, même échéance, deux locataires différents)", () => {
    const propositions = proposerRapprochements(
      [{ id: "ligne-1", date: "2026-08-05", montant: "850.00", libelle: "VIR MARTIN LOYER" }],
      [
        { id: "paiement-dupont", montant: "850.00", dateEcheance: "2026-08-01", nomsLocataires: ["Dupont"] },
        { id: "paiement-martin", montant: "850.00", dateEcheance: "2026-08-01", nomsLocataires: ["Martin"] }
      ]
    );

    expect(propositions).toHaveLength(1);
    expect(propositions[0]?.candidats).toHaveLength(2);
    const parId = Object.fromEntries(propositions[0]!.candidats.map((c) => [c.paiementId, c.criteresCorrespondants]));
    expect(parId["paiement-dupont"]).toEqual(["montant", "date"]);
    expect(parId["paiement-martin"]).toEqual(["montant", "date", "reference"]);
  });

  it("ignore un candidat dont le montant diffère", () => {
    const propositions = proposerRapprochements(
      [{ id: "ligne-1", date: "2026-08-05", montant: "850.00", libelle: "X" }],
      [{ id: "paiement-1", montant: "900.00", dateEcheance: "2026-08-01", nomsLocataires: [] }]
    );
    expect(propositions).toEqual([]);
  });

  it("ignore un candidat dont la date est hors tolérance (5 jours par défaut)", () => {
    const propositions = proposerRapprochements(
      [{ id: "ligne-1", date: "2026-08-10", montant: "850.00", libelle: "X" }],
      [{ id: "paiement-1", montant: "850.00", dateEcheance: "2026-08-01", nomsLocataires: [] }]
    );
    expect(propositions).toEqual([]);
  });

  it("accepte un candidat dans la tolérance de date par défaut", () => {
    const propositions = proposerRapprochements(
      [{ id: "ligne-1", date: "2026-08-03", montant: "850.00", libelle: "X" }],
      [{ id: "paiement-1", montant: "850.00", dateEcheance: "2026-08-01", nomsLocataires: [] }]
    );
    expect(propositions).toHaveLength(1);
  });

  it("respecte une tolérance de date personnalisée", () => {
    const propositions = proposerRapprochements(
      [{ id: "ligne-1", date: "2026-08-10", montant: "850.00", libelle: "X" }],
      [{ id: "paiement-1", montant: "850.00", dateEcheance: "2026-08-01", nomsLocataires: [] }],
      { toleranceJours: 15 }
    );
    expect(propositions).toHaveLength(1);
  });

  it("ne propose rien pour une ligne sans aucun candidat", () => {
    const propositions = proposerRapprochements(
      [{ id: "ligne-1", date: "2026-08-05", montant: "1234.56", libelle: "X" }],
      [{ id: "paiement-1", montant: "850.00", dateEcheance: "2026-08-01", nomsLocataires: [] }]
    );
    expect(propositions).toEqual([]);
  });

  it("reconnaît un nom malgré une casse et des accents différents", () => {
    const propositions = proposerRapprochements(
      [{ id: "ligne-1", date: "2026-08-05", montant: "850.00", libelle: "VIR ÉLODIE DUPONT" }],
      [{ id: "paiement-1", montant: "850.00", dateEcheance: "2026-08-01", nomsLocataires: ["Élodie"] }]
    );
    expect(propositions[0]?.candidats[0]?.criteresCorrespondants).toContain("reference");
  });

  it("tolère un nom composé formaté différemment dans le libellé (tiret vs espace)", () => {
    const propositions = proposerRapprochements(
      [{ id: "ligne-1", date: "2026-08-05", montant: "850.00", libelle: "VIR DURAND MARTIN LOYER" }],
      [{ id: "paiement-1", montant: "850.00", dateEcheance: "2026-08-01", nomsLocataires: ["Durand-Martin"] }]
    );
    expect(propositions[0]?.candidats[0]?.criteresCorrespondants).toContain("reference");
  });

  it("ne se laisse pas piéger par une imprécision flottante sur le montant (10 centimes d'écart)", () => {
    const propositions = proposerRapprochements(
      [{ id: "ligne-1", date: "2026-08-05", montant: "850.10", libelle: "X" }],
      [{ id: "paiement-1", montant: "850.00", dateEcheance: "2026-08-01", nomsLocataires: [] }]
    );
    expect(propositions).toEqual([]);
  });

  it("traite plusieurs lignes CSV indépendamment", () => {
    const propositions = proposerRapprochements(
      [
        { id: "ligne-1", date: "2026-08-05", montant: "850.00", libelle: "VIR DUPONT" },
        { id: "ligne-2", date: "2026-08-06", montant: "900.00", libelle: "VIR MARTIN" }
      ],
      [
        { id: "paiement-1", montant: "850.00", dateEcheance: "2026-08-01", nomsLocataires: ["Dupont"] },
        { id: "paiement-2", montant: "900.00", dateEcheance: "2026-08-02", nomsLocataires: ["Martin"] }
      ]
    );
    expect(propositions).toHaveLength(2);
    expect(propositions.map((p) => p.ligneCsvId)).toEqual(["ligne-1", "ligne-2"]);
  });
});
