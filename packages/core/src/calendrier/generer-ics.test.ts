import { describe, expect, it } from "vitest";
import { genererIcs } from "./generer-ics";

const MAINTENANT = new Date("2026-09-15T10:00:00.000Z");

describe("genererIcs", () => {
  it("génère un VCALENDAR vide pour une liste sans événement", () => {
    const ics = genererIcs([], MAINTENANT);
    expect(ics).toBe("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//appli-immo//Calendrier//FR\r\nCALSCALE:GREGORIAN\r\nEND:VCALENDAR\r\n");
  });

  it("génère un VEVENT complet avec DTEND et DESCRIPTION", () => {
    const ics = genererIcs(
      [
        {
          id: "abc-123",
          titre: "Visite plombier",
          dateDebut: new Date("2026-09-20T14:00:00.000Z"),
          dateFin: new Date("2026-09-20T15:00:00.000Z"),
          notes: "Fuite évier cuisine"
        }
      ],
      MAINTENANT
    );

    expect(ics).toContain("BEGIN:VEVENT\r\n");
    expect(ics).toContain("UID:abc-123@appli-immo\r\n");
    expect(ics).toContain("DTSTAMP:20260915T100000Z\r\n");
    expect(ics).toContain("DTSTART:20260920T140000Z\r\n");
    expect(ics).toContain("DTEND:20260920T150000Z\r\n");
    expect(ics).toContain("SUMMARY:Visite plombier\r\n");
    expect(ics).toContain("DESCRIPTION:Fuite évier cuisine\r\n");
    expect(ics).toContain("END:VEVENT\r\n");
  });

  it("omet DTEND et DESCRIPTION quand absents, sans inventer de durée par défaut", () => {
    const ics = genererIcs(
      [{ id: "xyz", titre: "Rappel", dateDebut: new Date("2026-09-20T14:00:00.000Z"), dateFin: null, notes: null }],
      MAINTENANT
    );

    expect(ics).not.toContain("DTEND");
    expect(ics).not.toContain("DESCRIPTION");
    expect(ics).toContain("DTSTART:20260920T140000Z\r\n");
  });

  it("échappe les caractères spéciaux RFC 5545 dans SUMMARY/DESCRIPTION", () => {
    const ics = genererIcs(
      [
        {
          id: "esc",
          titre: "Rendez-vous; urgent, important",
          dateDebut: new Date("2026-09-20T14:00:00.000Z"),
          dateFin: null,
          notes: "Ligne 1\nLigne 2 avec un \\backslash"
        }
      ],
      MAINTENANT
    );

    expect(ics).toContain("SUMMARY:Rendez-vous\\; urgent\\, important\r\n");
    expect(ics).toContain("DESCRIPTION:Ligne 1\\nLigne 2 avec un \\\\backslash\r\n");
  });

  it("plie les lignes dépassant 75 octets, mesurés en UTF-8 et sans casser un caractère multi-octets", () => {
    // "é" pèse 2 octets en UTF-8 — un titre de 70 caractères accentués
    // dépasse largement 75 octets et doit être plié.
    const titreLong = "é".repeat(70);
    const ics = genererIcs(
      [{ id: "long", titre: titreLong, dateDebut: new Date("2026-09-20T14:00:00.000Z"), dateFin: null, notes: null }],
      MAINTENANT
    );

    const ligneSummary = ics
      .split("\r\n")
      .find((ligne) => ligne.startsWith("SUMMARY:"));
    expect(ligneSummary).toBeDefined();
    // Première ligne (avant le premier pli) : "SUMMARY:" (8 octets) + au
    // plus 67 octets de "é" (33 caractères, 66 octets, le 34e ferait
    // dépasser 75) sans dépasser la limite.
    expect(Buffer.byteLength(ligneSummary!, "utf-8")).toBeLessThanOrEqual(75);

    // Reconstitue le texte pour vérifier qu'aucun caractère n'a été perdu
    // ou coupé au repli (déplier = retirer "\r\n " entre les segments).
    const indexDebut = ics.indexOf("SUMMARY:");
    const brut = ics.slice(indexDebut, ics.indexOf("\r\nEND:VEVENT"));
    const reconstitue = brut.replace("SUMMARY:", "").split("\r\n ").join("");
    expect(reconstitue).toBe(titreLong);
  });

  it("sépare chaque ligne par CRLF, jamais LF seul", () => {
    const ics = genererIcs(
      [{ id: "crlf", titre: "Test", dateDebut: new Date("2026-09-20T14:00:00.000Z"), dateFin: null, notes: null }],
      MAINTENANT
    );
    expect(ics.includes("\r\n")).toBe(true);
    // Aucun \n qui ne soit pas précédé d'un \r.
    expect(/(?<!\r)\n/.test(ics)).toBe(false);
  });
});
