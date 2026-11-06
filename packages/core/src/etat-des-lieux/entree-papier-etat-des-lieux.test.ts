import { describe, expect, it } from "vitest";
import {
  avertissementDateEntreePapier,
  contenuEstUnPdf,
  mentionCourteEntreePapier,
  mentionEntreePapier,
  refusDateEntreePapier
} from "./entree-papier-etat-des-lieux";

describe("mentionCourteEntreePapier", () => {
  it("date courte et original conservé", () => {
    expect(
      mentionCourteEntreePapier({ dateSignature: "2026-08-01", lieu: "Lyon", nomsSignataires: ["SCI", "Claire Martin"] })
    ).toBe("Signé sur papier le 01/08/2026 — original conservé par le bailleur");
  });
});

describe("mentionEntreePapier", () => {
  it("date courte, lieu et signataires dans l'ordre déclaré", () => {
    expect(
      mentionEntreePapier({
        dateSignature: "2026-08-01",
        lieu: "Lyon",
        nomsSignataires: ["SCI Exemple", "Claire Martin", "Paul Durand"]
      })
    ).toBe(
      "État des lieux d'entrée établi et signé sur papier le 01/08/2026 à Lyon par SCI Exemple, Claire Martin et Paul Durand. Original conservé par le bailleur."
    );
  });

  it("deux signataires : liés par « et »", () => {
    expect(
      mentionEntreePapier({ dateSignature: "2026-08-01", lieu: "Lyon", nomsSignataires: ["SCI Exemple", "Claire Martin"] })
    ).toContain("par SCI Exemple et Claire Martin.");
  });
});

const octets = (texte: string): Uint8Array => new TextEncoder().encode(texte);

describe("contenuEstUnPdf", () => {
  it("reconnaît l'en-tête %PDF-", () => {
    expect(contenuEstUnPdf(octets("%PDF-1.7\n..."))).toBe(true);
  });

  it("refuse un autre contenu, un en-tête tronqué ou un fichier vide", () => {
    expect(contenuEstUnPdf(octets("\x89PNG\r\n"))).toBe(false);
    expect(contenuEstUnPdf(octets(" %PDF-1.7"))).toBe(false);
    expect(contenuEstUnPdf(octets("%PDF"))).toBe(false);
    expect(contenuEstUnPdf(new Uint8Array())).toBe(false);
  });
});

describe("refusDateEntreePapier", () => {
  it("accepte une date passée et la date du jour", () => {
    expect(refusDateEntreePapier("2026-08-01", "2026-11-06")).toBeNull();
    expect(refusDateEntreePapier("2026-11-06", "2026-11-06")).toBeNull();
  });

  it("refuse une date dans le futur, même le lendemain", () => {
    expect(refusDateEntreePapier("2026-11-07", "2026-11-06")).toMatch(/futur/);
  });

  it("refuse une date invalide ou mal formée", () => {
    for (const date of ["2026-02-30", "2026-13-01", "01/08/2026", "2026-8-1", ""]) {
      expect(refusDateEntreePapier(date, "2026-11-06")).toMatch(/invalide/);
    }
  });
});

describe("avertissementDateEntreePapier", () => {
  it("aucun avertissement à un mois près, bornes comprises", () => {
    expect(avertissementDateEntreePapier("2026-08-01", "2026-08-01")).toBeNull();
    expect(avertissementDateEntreePapier("2026-07-01", "2026-08-01")).toBeNull();
    expect(avertissementDateEntreePapier("2026-09-01", "2026-08-01")).toBeNull();
  });

  it("avertit au-delà d'un mois, avant comme après", () => {
    expect(avertissementDateEntreePapier("2026-06-30", "2026-08-01")).toBe(
      "La date de l'état des lieux d'entrée (30/06/2026) s'écarte de plus d'un mois du début du bail (01/08/2026)."
    );
    expect(avertissementDateEntreePapier("2026-09-02", "2026-08-01")).not.toBeNull();
  });

  it("fin de mois : un mois après le 31 janvier est le 28 février", () => {
    expect(avertissementDateEntreePapier("2026-02-28", "2026-01-31")).toBeNull();
    expect(avertissementDateEntreePapier("2026-03-01", "2026-01-31")).not.toBeNull();
  });
});
