import { describe, expect, it } from "vitest";
import { texteArchivageBailBrouillon, texteArchivageRemboursement } from "./textes-confirmation";

// Commit 5 des petites suites (décision 6) : archivage d'un bail en
// brouillon et d'un remboursement, branchés avec la confirmation commune.
// Textes ajustés après la revue financial-logic-reviewer : effet exact sur
// le reste à rembourser selon le type, l'échéance liée et la retenue.

describe("texteArchivageBailBrouillon", () => {
  it("nomme l'appartement et la date de début, dit où il reste visible et ce qui n'est pas archivé", () => {
    const texte = texteArchivageBailBrouillon({ dateDebut: "2026-09-01" }, "12");
    expect(texte.titre).toBe("Archiver ce bail en brouillon ?");
    expect(texte.explication).toBe(
      "Le bail en brouillon de l'appartement 12 (début prévu le 01/09/2026) ne sera plus le bail en cours de l'appartement, qui pourra recevoir un nouveau bail ; il reste visible dans « Historique des baux » avec « Afficher les archivés ». Les locataires et garants rattachés, ses documents et son état des lieux ne sont pas archivés. L'archivage ne peut pas être annulé depuis l'application."
    );
    expect(texte.libelleConfirmer).toBe("Archiver le brouillon");
    expect(texte.messageRepli).toBe("Impossible d'archiver ce bail.");
  });
});

const base = {
  montantOrigine: "60.00",
  montantRembourse: "60.00",
  dateRemboursement: "2026-03-01",
  paiementId: "paiement",
  pieceJustificativeNomFichier: null
};

describe("texteArchivageRemboursement", () => {
  it("trop-perçu lié à une échéance : le reste remonte AU PLUS du montant (plancher à 0), carte du tableau de bord", () => {
    const texte = texteArchivageRemboursement({ ...base, type: "trop_percu" });
    expect(texte.titre).toBe("Archiver ce remboursement ?");
    expect(texte.explication).toBe(
      "Le remboursement de trop-perçu de 60.00 € du 01/03/2026 ne comptera plus comme remboursé. Le reste à rembourser au locataire remonte au plus de 60.00 €, et le trop-perçu peut réapparaître dans « Remboursements en attente » du tableau de bord. L'archivage ne peut pas être annulé depuis l'application."
    );
    expect(texte.libelleConfirmer).toBe("Archiver le remboursement");
    expect(texte.messageRepli).toBe("Impossible d'archiver ce remboursement.");
  });

  it("remboursement sans échéance liée : aucun calcul n'en dépend", () => {
    const texte = texteArchivageRemboursement({ ...base, type: "trop_percu", paiementId: null });
    expect(texte.explication).toBe(
      "Le remboursement de trop-perçu de 60.00 € du 01/03/2026 ne comptera plus comme remboursé. Il n'est rattaché à aucune échéance : aucun reste à rembourser n'en dépend. L'archivage ne peut pas être annulé depuis l'application."
    );
  });

  it("dépôt de garantie restitué en entier : le reste du dépôt remonte du montant", () => {
    const texte = texteArchivageRemboursement({
      ...base,
      type: "depot_garantie",
      montantOrigine: "800.00",
      montantRembourse: "800.00"
    });
    expect(texte.explication).toBe(
      "Le remboursement de dépôt de garantie de 800.00 € du 01/03/2026 ne comptera plus comme remboursé. Le reste à rembourser du dépôt de garantie remonte de 800.00 €. L'archivage ne peut pas être annulé depuis l'application."
    );
  });

  it("dépôt avec retenue partielle et justificatif : retenue et motif n'apparaissent plus, justificatif conservé", () => {
    const texte = texteArchivageRemboursement({
      ...base,
      type: "depot_garantie",
      montantOrigine: "800.00",
      montantRembourse: "400.00",
      pieceJustificativeNomFichier: "devis.pdf"
    });
    expect(texte.explication).toBe(
      "Le remboursement de dépôt de garantie de 400.00 € du 01/03/2026 ne comptera plus comme remboursé. Le reste à rembourser du dépôt de garantie remonte de 400.00 €. La retenue de 400.00 € et son motif n'apparaîtront plus. Le justificatif est conservé mais n'est plus affiché. L'archivage ne peut pas être annulé depuis l'application."
    );
  });

  it("retenue totale (0 € restitué) : aucun montant ne remonte, seule la retenue disparaît", () => {
    const texte = texteArchivageRemboursement({
      ...base,
      type: "depot_garantie",
      montantOrigine: "800.00",
      montantRembourse: "0.00",
      pieceJustificativeNomFichier: "constat.pdf"
    });
    expect(texte.explication).toBe(
      "La retenue totale de 800.00 € sur le dépôt de garantie, saisie le 01/03/2026, et son motif n'apparaîtront plus. Le justificatif est conservé mais n'est plus affiché. L'archivage ne peut pas être annulé depuis l'application."
    );
  });
});
