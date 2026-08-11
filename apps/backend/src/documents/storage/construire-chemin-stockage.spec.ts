import { describe, expect, it } from "vitest";
import { construireCheminStockage } from "./construire-chemin-stockage";

describe("construireCheminStockage", () => {
  it("organise le chemin par entiteType puis entiteId puis documentId", () => {
    expect(construireCheminStockage("appartement", "entite-id", "document-id")).toBe(
      "documents/appartement/entite-id/document-id.enc"
    );
  });

  it("ne fait apparaître aucun autre segment que les UUID fournis (jamais de nom de fichier)", () => {
    const chemin = construireCheminStockage("locataire", "abc-123", "def-456");
    expect(chemin.split("/")).toEqual(["documents", "locataire", "abc-123", "def-456.enc"]);
  });

  it("produit un chemin différent pour chaque type d'entité, y compris etat_des_lieux", () => {
    expect(construireCheminStockage("etat_des_lieux", "e1", "d1")).toBe("documents/etat_des_lieux/e1/d1.enc");
  });
});
