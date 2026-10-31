import { describe, expect, it } from "vitest";
import { libelleStatutPdf } from "./statut-pdf-etat-des-lieux";

describe("libelleStatutPdf", () => {
  it("affiche 'Prêt' avec la date de production quand le PDF existe", () => {
    const dateProduction = "2026-10-30T10:05:00.000Z";
    expect(
      libelleStatutPdf({
        phase: "entree",
        docx: { documentId: "d1", createdAt: "2026-10-30T10:00:00.000Z" },
        pdf: { documentId: "p1", createdAt: dateProduction }
      })
    ).toBe(`Prêt (${new Date(dateProduction).toLocaleDateString("fr-FR")})`);
  });

  it("affiche 'En préparation' quand le .docx a moins de 30 minutes et le PDF manque encore", () => {
    const maintenant = new Date("2026-10-30T10:29:00.000Z");
    expect(
      libelleStatutPdf(
        { phase: "entree", docx: { documentId: "d1", createdAt: "2026-10-30T10:00:00.000Z" }, pdf: null },
        maintenant
      )
    ).toBe("En préparation");
  });

  it("affiche 'En préparation' à exactement une seconde du seuil de 30 minutes", () => {
    const maintenant = new Date("2026-10-30T10:29:59.000Z");
    expect(
      libelleStatutPdf(
        { phase: "entree", docx: { documentId: "d1", createdAt: "2026-10-30T10:00:00.000Z" }, pdf: null },
        maintenant
      )
    ).toBe("En préparation");
  });

  it("affiche 'Échec de la conversion' quand le .docx a plus de 30 minutes et le PDF manque toujours", () => {
    const maintenant = new Date("2026-10-30T10:30:01.000Z");
    expect(
      libelleStatutPdf(
        { phase: "entree", docx: { documentId: "d1", createdAt: "2026-10-30T10:00:00.000Z" }, pdf: null },
        maintenant
      )
    ).toBe("Échec de la conversion");
  });

  it("affiche 'Indisponible' quand ni le .docx ni le PDF n'existent", () => {
    expect(libelleStatutPdf({ phase: "entree", docx: null, pdf: null })).toBe("Indisponible");
  });

  it("affiche 'Indisponible' quand le statut n'a pas encore été chargé (undefined)", () => {
    expect(libelleStatutPdf(undefined)).toBe("Indisponible");
  });
});
