import { describe, expect, it } from "vitest";
import type { DocumentMetier } from "../documents/api";
import { erreursSaisieEntreePapier, fichierEstUnPdf, piecesAvecPhotosEntree, type SaisieEntreePapier } from "./entree-papier-formulaire";

function photo(surcharge: Partial<DocumentMetier>): DocumentMetier {
  return {
    id: "p",
    archivedAt: null,
    etatDesLieuxPieceType: "sejour",
    etatDesLieuxPieceNumero: null,
    etatDesLieuxPhase: "entree",
    ...surcharge
  } as DocumentMetier;
}

const SAISIE: SaisieEntreePapier = {
  dateSignature: "2026-08-01",
  lieu: "Lyon",
  bailleurNom: "SCI Turgot",
  locataireIds: ["l1"],
  scan: { nom: "scan.pdf", taille: 1000 },
  fideliteConfirmee: true
};

describe("piecesAvecPhotosEntree", () => {
  it("photos d'entrée ou sans phase, non archivées, par pièce, sans doublon et triées", () => {
    expect(
      piecesAvecPhotosEntree([
        photo({ etatDesLieuxPieceType: "sejour" }),
        photo({ etatDesLieuxPieceType: "chambre", etatDesLieuxPieceNumero: 1 }),
        photo({ etatDesLieuxPieceType: "chambre", etatDesLieuxPieceNumero: 1, etatDesLieuxPhase: null }),
        photo({ etatDesLieuxPieceType: "cuisine", etatDesLieuxPhase: "sortie" }),
        photo({ etatDesLieuxPieceType: "wc", etatDesLieuxPieceNumero: 1, archivedAt: "2026-11-01T00:00:00Z" })
      ])
    ).toEqual(["Chambre 1", "Séjour"]);
  });

  it("aucune photo d'entrée active : liste vide", () => {
    expect(piecesAvecPhotosEntree([photo({ etatDesLieuxPhase: "sortie" })])).toEqual([]);
  });
});

describe("erreursSaisieEntreePapier", () => {
  it("saisie complète : aucune erreur", () => {
    expect(erreursSaisieEntreePapier(SAISIE, "declaration", "2026-11-06")).toEqual([]);
  });

  it("chaque champ manquant ou invalide, dans l'ordre du formulaire", () => {
    expect(
      erreursSaisieEntreePapier(
        { dateSignature: "2026-12-01", lieu: " ", bailleurNom: "", locataireIds: [], scan: null, fideliteConfirmee: false },
        "declaration",
        "2026-11-06"
      )
    ).toEqual([
      "La date de l'état des lieux d'entrée papier ne peut pas être dans le futur.",
      "Le lieu est obligatoire.",
      "Le nom du bailleur est obligatoire.",
      "Cochez au moins un locataire signataire.",
      "Le scan PDF de l'état des lieux signé est obligatoire.",
      "Confirmez que les états saisis reproduisent fidèlement l'original."
    ]);
  });

  it("correction : le scan devient facultatif", () => {
    expect(erreursSaisieEntreePapier({ ...SAISIE, scan: null }, "correction", "2026-11-06")).toEqual([]);
  });

  it("date absente, scan trop lourd", () => {
    expect(
      erreursSaisieEntreePapier({ ...SAISIE, dateSignature: "", scan: { nom: "s.pdf", taille: 11 * 1024 * 1024 } }, "declaration", "2026-11-06")
    ).toEqual(["La date est obligatoire.", "Le scan dépasse 10 Mo."]);
  });
});

describe("fichierEstUnPdf", () => {
  it("lit l'en-tête du contenu, pas le nom", async () => {
    expect(await fichierEstUnPdf(new Blob(["%PDF-1.7\n"]))).toBe(true);
    expect(await fichierEstUnPdf(new Blob(["\x89PNG\r\n"]))).toBe(false);
  });
});
