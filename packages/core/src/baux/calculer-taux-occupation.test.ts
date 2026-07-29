import { describe, expect, it } from "vitest";
import { calculerJoursOccupes, calculerTauxOccupation, type IntervalleOccupationBail } from "./calculer-taux-occupation";

describe("calculerJoursOccupes", () => {
  it("compte les jours occupés d'un unique bail entièrement dans la période", () => {
    const baux: IntervalleOccupationBail[] = [
      { dateDebut: "2026-01-10", dateFin: "2026-01-20", dateActivation: "2026-01-10" }
    ];
    // 10 au 20 janvier inclus = 11 jours
    expect(calculerJoursOccupes(baux, "2026-01-01", "2026-01-31")).toBe(11);
  });

  it("exclut un bail jamais activé (dateActivation null), quel que soit dateDebut/dateFin", () => {
    const baux: IntervalleOccupationBail[] = [
      { dateDebut: "2026-01-01", dateFin: "2026-01-31", dateActivation: null }
    ];
    expect(calculerJoursOccupes(baux, "2026-01-01", "2026-01-31")).toBe(0);
  });

  it("un bail preavis (dateFin future connue) compte occupé jusqu'à dateFin, jamais tronqué à aujourd'hui", () => {
    const baux: IntervalleOccupationBail[] = [
      { dateDebut: "2026-01-01", dateFin: "2026-06-30", dateActivation: "2026-01-01" }
    ];
    // Toute la période demandée (année complète) doit être comptée occupée,
    // y compris des mois "futurs" par rapport à une éventuelle date du jour.
    expect(calculerJoursOccupes(baux, "2026-01-01", "2026-12-31")).toBe(181); // jan(31)+fev(28)+mar(31)+avr(30)+mai(31)+juin(30)
  });

  it("un bail encore en cours (dateFin null) se prolonge au moins jusqu'à la fin de la période", () => {
    const baux: IntervalleOccupationBail[] = [
      { dateDebut: "2026-01-01", dateFin: null, dateActivation: "2026-01-01" }
    ];
    expect(calculerJoursOccupes(baux, "2026-01-01", "2026-01-31")).toBe(31);
  });

  it("union de deux baux qui SE CHEVAUCHENT : ne compte jamais deux fois le même jour", () => {
    const baux: IntervalleOccupationBail[] = [
      { dateDebut: "2026-01-01", dateFin: "2026-01-20", dateActivation: "2026-01-01" },
      { dateDebut: "2026-01-15", dateFin: "2026-01-31", dateActivation: "2026-01-15" }
    ];
    // Union = 1er au 31 janvier = 31 jours, jamais 20 + 17 = 37.
    expect(calculerJoursOccupes(baux, "2026-01-01", "2026-01-31")).toBe(31);
  });

  it("deux baux qui se touchent EXACTEMENT (sortie/entrée le même jour) : le jour commun n'est compté qu'une fois", () => {
    const baux: IntervalleOccupationBail[] = [
      { dateDebut: "2026-01-01", dateFin: "2026-01-15", dateActivation: "2026-01-01" },
      { dateDebut: "2026-01-15", dateFin: "2026-01-31", dateActivation: "2026-01-15" }
    ];
    // Union = 1er au 31 janvier = 31 jours, jamais 15 + 17 = 32.
    expect(calculerJoursOccupes(baux, "2026-01-01", "2026-01-31")).toBe(31);
  });

  it("deux baux qui s'enchaînent au jour près (sortie le 15, entrée le 16) : aucun jour perdu ni compté deux fois", () => {
    const baux: IntervalleOccupationBail[] = [
      { dateDebut: "2026-01-01", dateFin: "2026-01-15", dateActivation: "2026-01-01" },
      { dateDebut: "2026-01-16", dateFin: "2026-01-31", dateActivation: "2026-01-16" }
    ];
    expect(calculerJoursOccupes(baux, "2026-01-01", "2026-01-31")).toBe(31);
  });

  it("deux baux successifs SANS chevauchement s'additionnent normalement", () => {
    const baux: IntervalleOccupationBail[] = [
      { dateDebut: "2026-01-01", dateFin: "2026-01-10", dateActivation: "2026-01-01" },
      { dateDebut: "2026-01-15", dateFin: "2026-01-20", dateActivation: "2026-01-15" }
    ];
    expect(calculerJoursOccupes(baux, "2026-01-01", "2026-01-31")).toBe(10 + 6);
  });

  it("un bail hors période n'est pas compté", () => {
    const baux: IntervalleOccupationBail[] = [
      { dateDebut: "2025-01-01", dateFin: "2025-12-31", dateActivation: "2025-01-01" }
    ];
    expect(calculerJoursOccupes(baux, "2026-01-01", "2026-12-31")).toBe(0);
  });
});

describe("calculerTauxOccupation", () => {
  it("retourne un ratio entre 0 et 1", () => {
    const baux: IntervalleOccupationBail[] = [
      { dateDebut: "2026-01-01", dateFin: "2026-01-15", dateActivation: "2026-01-01" }
    ];
    expect(calculerTauxOccupation(baux, "2026-01-01", "2026-01-30")).toBeCloseTo(15 / 30, 5);
  });

  it("retourne 0 pour un appartement jamais occupé sur la période", () => {
    expect(calculerTauxOccupation([], "2026-01-01", "2026-01-31")).toBe(0);
  });

  it("retourne 1 si occupé sur toute la période", () => {
    const baux: IntervalleOccupationBail[] = [
      { dateDebut: "2025-01-01", dateFin: null, dateActivation: "2025-01-01" }
    ];
    expect(calculerTauxOccupation(baux, "2026-01-01", "2026-01-31")).toBe(1);
  });
});
