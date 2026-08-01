import { describe, expect, it } from "vitest";
import {
  ajouterJours,
  ajouterMois,
  dateVersJourOrdinal,
  estBissextile,
  joursDansLeMois,
  libelleMoisDepuisDate
} from "./calendrier";

describe("estBissextile", () => {
  it("2024 est bissextile (divisible par 4, pas par 100)", () => {
    expect(estBissextile(2024)).toBe(true);
  });
  it("2100 n'est pas bissextile (divisible par 100, pas par 400)", () => {
    expect(estBissextile(2100)).toBe(false);
  });
  it("2000 est bissextile (divisible par 400)", () => {
    expect(estBissextile(2000)).toBe(true);
  });
  it("2026 n'est pas bissextile", () => {
    expect(estBissextile(2026)).toBe(false);
  });
});

describe("joursDansLeMois", () => {
  it("février d'une année bissextile a 29 jours", () => {
    expect(joursDansLeMois(2024, 2)).toBe(29);
  });
  it("février d'une année non bissextile a 28 jours", () => {
    expect(joursDansLeMois(2026, 2)).toBe(28);
  });
  it("avril a 30 jours", () => {
    expect(joursDansLeMois(2026, 4)).toBe(30);
  });
});

describe("ajouterJours", () => {
  it("ajoute des jours dans le même mois", () => {
    expect(ajouterJours("2026-07-10", 5)).toBe("2026-07-15");
  });
  it("franchit une fin de mois", () => {
    expect(ajouterJours("2026-07-28", 5)).toBe("2026-08-02");
  });
  it("franchit une fin d'année", () => {
    expect(ajouterJours("2026-12-28", 5)).toBe("2027-01-02");
  });
  it("retranche des jours (nombre négatif)", () => {
    expect(ajouterJours("2026-07-03", -5)).toBe("2026-06-28");
  });
  it("gère un passage par février bissextile", () => {
    expect(ajouterJours("2024-02-27", 3)).toBe("2024-03-01");
  });
});

describe("ajouterMois", () => {
  it("ajoute des mois dans la même année", () => {
    expect(ajouterMois("2026-03-15", 2)).toBe("2026-05-15");
  });
  it("franchit une fin d'année", () => {
    expect(ajouterMois("2026-11-10", 3)).toBe("2027-02-10");
  });
  it("ramène au dernier jour du mois cible si le jour d'origine n'existe pas", () => {
    expect(ajouterMois("2026-01-31", 1)).toBe("2026-02-28");
  });
  it("respecte le 29 février cible sur une année bissextile", () => {
    expect(ajouterMois("2023-12-29", 2)).toBe("2024-02-29");
  });
  it("ajoute 0 mois : identité", () => {
    expect(ajouterMois("2026-06-15", 0)).toBe("2026-06-15");
  });
});

describe("dateVersJourOrdinal", () => {
  it("croît strictement d'un jour à l'autre", () => {
    expect(dateVersJourOrdinal("2026-07-11")).toBe(dateVersJourOrdinal("2026-07-10") + 1);
  });
  it("est cohérent avec ajouterJours sur un franchissement de mois", () => {
    const debut = "2026-07-28";
    const fin = ajouterJours(debut, 10);
    expect(dateVersJourOrdinal(fin) - dateVersJourOrdinal(debut)).toBe(10);
  });
  it("est cohérent avec ajouterJours sur un franchissement d'année bissextile", () => {
    const debut = "2024-02-20";
    const fin = ajouterJours(debut, 15);
    expect(dateVersJourOrdinal(fin) - dateVersJourOrdinal(debut)).toBe(15);
  });
  it("est cohérent avec ajouterJours sur plusieurs années", () => {
    const debut = "2023-01-01";
    const fin = ajouterJours(debut, 800);
    expect(dateVersJourOrdinal(fin) - dateVersJourOrdinal(debut)).toBe(800);
  });
});

describe("libelleMoisDepuisDate", () => {
  it("janvier pour le premier mois", () => {
    expect(libelleMoisDepuisDate("2026-01-15")).toBe("janvier");
  });

  it("décembre pour le dernier mois", () => {
    expect(libelleMoisDepuisDate("2026-12-01")).toBe("décembre");
  });

  it("octobre pour le mois de bascule du décret 2026-596", () => {
    expect(libelleMoisDepuisDate("2026-10-01")).toBe("octobre");
  });
});
