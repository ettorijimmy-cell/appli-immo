import { describe, expect, it } from "vitest";
import {
  ajouterJours,
  ajouterMois,
  dateVersJourOrdinal,
  estBissextile,
  estDateIsoValide,
  formaterDateCourteFr,
  jourDeLaSemaine,
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

describe("jourDeLaSemaine", () => {
  it("2024-01-01 est un lundi (0)", () => {
    expect(jourDeLaSemaine("2024-01-01")).toBe(0);
  });

  it("le lendemain d'un lundi est un mardi (1)", () => {
    expect(jourDeLaSemaine("2024-01-02")).toBe(1);
  });

  it("sept jours plus tard retombe sur le même jour de semaine", () => {
    expect(jourDeLaSemaine("2024-01-08")).toBe(jourDeLaSemaine("2024-01-01"));
  });

  it("la veille d'un lundi est un dimanche (6)", () => {
    expect(jourDeLaSemaine("2023-12-31")).toBe(6);
  });

  it("franchit une année bissextile (2024, 366 jours) sans erreur de décalage", () => {
    // 2025-01-01 est un mercredi dans le calendrier réel.
    expect(jourDeLaSemaine("2025-01-01")).toBe(2);
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

describe("formaterDateCourteFr", () => {
  it("affiche une date ISO en JJ/MM/AAAA", () => {
    expect(formaterDateCourteFr("2026-08-01")).toBe("01/08/2026");
  });

  it("ne lit que la date d'un horodatage, sans conversion de fuseau", () => {
    expect(formaterDateCourteFr("2026-12-31T23:30:00.000Z")).toBe("31/12/2026");
  });
});

describe("estDateIsoValide", () => {
  it("accepte une date AAAA-MM-JJ qui existe", () => {
    expect(estDateIsoValide("2027-03-15")).toBe(true);
    expect(estDateIsoValide("2027-12-31")).toBe(true);
    expect(estDateIsoValide("2028-02-29")).toBe(true);
  });

  it("refuse un jour qui n'existe pas dans le mois", () => {
    expect(estDateIsoValide("2027-02-29")).toBe(false);
    expect(estDateIsoValide("2027-04-31")).toBe(false);
    expect(estDateIsoValide("2027-03-00")).toBe(false);
  });

  it("refuse un mois hors de 1 à 12", () => {
    expect(estDateIsoValide("2027-00-10")).toBe(false);
    expect(estDateIsoValide("2027-13-01")).toBe(false);
  });

  it("refuse tout autre format (horodatage, chiffres manquants, vide)", () => {
    expect(estDateIsoValide("2027-03-15T00:00:00.000Z")).toBe(false);
    expect(estDateIsoValide("2027-3-15")).toBe(false);
    expect(estDateIsoValide("15/03/2027")).toBe(false);
    expect(estDateIsoValide("")).toBe(false);
  });
});
