import { describe, expect, it } from "vitest";
import { evaluerCompletudeCategories, type DocumentPourCompletude } from "./evaluer-completude-categories";

function documentTest(overrides: Partial<DocumentPourCompletude> = {}): DocumentPourCompletude {
  return {
    id: "doc-1",
    categorie: "dpe",
    nomFichier: "dpe.pdf",
    dateExpiration: null,
    archive: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("evaluerCompletudeCategories", () => {
  it("signale une catégorie manquante si aucun document ne la couvre", () => {
    const resultat = evaluerCompletudeCategories([], ["dpe", "erp"], "2026-08-24");
    expect(resultat).toEqual([
      { categorie: "dpe", document: null },
      { categorie: "erp", document: null }
    ]);
  });

  it("retourne le document quand il est valide (non archivé, non expiré)", () => {
    const resultat = evaluerCompletudeCategories([documentTest()], ["dpe"], "2026-08-24");
    expect(resultat).toEqual([{ categorie: "dpe", document: { id: "doc-1", nomFichier: "dpe.pdf" } }]);
  });

  it("traite un document expiré comme manquant (contrairement à la simple présence en annexe)", () => {
    const resultat = evaluerCompletudeCategories(
      [documentTest({ dateExpiration: "2020-01-01" })],
      ["dpe"],
      "2026-08-24"
    );
    expect(resultat).toEqual([{ categorie: "dpe", document: null }]);
  });

  it("traite un document archivé comme manquant", () => {
    const resultat = evaluerCompletudeCategories([documentTest({ archive: true })], ["dpe"], "2026-08-24");
    expect(resultat).toEqual([{ categorie: "dpe", document: null }]);
  });

  it("ignore les catégories qui ne concernent pas cette entité", () => {
    const resultat = evaluerCompletudeCategories(
      [documentTest({ categorie: "piece_identite" })],
      ["dpe"],
      "2026-08-24"
    );
    expect(resultat).toEqual([{ categorie: "dpe", document: null }]);
  });

  it("retient le premier document valide de la liste (l'appelant trie par createdAt décroissant)", () => {
    const plusRecent = documentTest({ id: "doc-recent", nomFichier: "dpe-2026.pdf" });
    const plusAncien = documentTest({ id: "doc-ancien", nomFichier: "dpe-2020.pdf" });
    const resultat = evaluerCompletudeCategories([plusRecent, plusAncien], ["dpe"], "2026-08-24");
    expect(resultat[0]?.document).toEqual({ id: "doc-recent", nomFichier: "dpe-2026.pdf" });
  });
});
