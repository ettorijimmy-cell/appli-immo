import { describe, expect, it } from "vitest";
import {
  bauxHistoriqueVisibles,
  libelleBoutonRemboursements,
  remboursementsParBail,
  sectionRemboursementsVisible
} from "./remboursements-visibles";

// Commit 5b des petites suites : le remède « archivez d'abord le
// remboursement » (refus d'annuler un versement, d'archiver une échéance,
// de corriger un préavis) doit toujours être accessible depuis le desktop.

function remboursement(id: string, bailId: string, archive = false) {
  return { id, bailId, archivedAt: archive ? "2026-11-20T10:00:00.000Z" : null };
}

describe("sectionRemboursementsVisible", () => {
  it("bail résilié : toujours visible (création des remboursements), même sans remboursement", () => {
    expect(sectionRemboursementsVisible("resilie", [])).toBe(true);
  });

  it("bail en préavis ou actif avec un remboursement actif : visible", () => {
    expect(sectionRemboursementsVisible("preavis", [remboursement("r1", "b1")])).toBe(true);
    expect(sectionRemboursementsVisible("actif", [remboursement("r1", "b1")])).toBe(true);
  });

  it("bail en préavis, actif ou brouillon sans remboursement actif : masquée", () => {
    expect(sectionRemboursementsVisible("preavis", [])).toBe(false);
    expect(sectionRemboursementsVisible("actif", [remboursement("r1", "b1", true)])).toBe(false);
    expect(sectionRemboursementsVisible("brouillon", [])).toBe(false);
  });
});

describe("remboursementsParBail", () => {
  const liste = [
    remboursement("r1", "b1"),
    remboursement("r2", "b1", true),
    remboursement("r3", "b2", true),
    remboursement("r4", "b3")
  ];

  it("archivés masqués : seules les lignes actives, compteur des actifs", () => {
    const parBail = remboursementsParBail(liste, false);
    expect(parBail.get("b1")).toEqual({ lignes: [liste[0]], nbActifs: 1 });
    expect(parBail.get("b3")).toEqual({ lignes: [liste[3]], nbActifs: 1 });
    // Aucun actif et archivés masqués : le bail n'a pas d'entrée (pas de bouton).
    expect(parBail.has("b2")).toBe(false);
  });

  it("archivés affichés : toutes les lignes, dans l'ordre reçu ; le compteur reste celui des actifs", () => {
    const parBail = remboursementsParBail(liste, true);
    expect(parBail.get("b1")).toEqual({ lignes: [liste[0], liste[1]], nbActifs: 1 });
    expect(parBail.get("b2")).toEqual({ lignes: [liste[2]], nbActifs: 0 });
  });

  it("liste vide : aucune entrée", () => {
    expect(remboursementsParBail([], true).size).toBe(0);
  });
});

// Relecture du commit 5b : un bail archivé (résilié puis archivé, ou
// brouillon archivé) peut garder des remboursements actifs ; il reste
// affiché filtre décoché, sinon le remède serait caché derrière
// « Afficher les archivés ».
describe("bauxHistoriqueVisibles", () => {
  const baux = [
    { id: "b1", statut: "resilie" as const },
    { id: "b2", statut: "archive" as const },
    { id: "b3", statut: "archive" as const }
  ];
  const remboursements = [
    { id: "r1", bailId: "b2", archivedAt: null },
    { id: "r2", bailId: "b3", archivedAt: "2026-11-20T10:00:00.000Z" }
  ];

  it("filtre décoché : baux non archivés, plus les archivés qui portent un remboursement actif", () => {
    expect(bauxHistoriqueVisibles(baux, remboursements, false).map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it("filtre coché : tous les baux", () => {
    expect(bauxHistoriqueVisibles(baux, remboursements, true).map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
  });
});

describe("libelleBoutonRemboursements", () => {
  it("compte les actifs, au singulier ou au pluriel", () => {
    expect(libelleBoutonRemboursements(0)).toBe("Remboursements (0 actif)");
    expect(libelleBoutonRemboursements(1)).toBe("Remboursements (1 actif)");
    expect(libelleBoutonRemboursements(2)).toBe("Remboursements (2 actifs)");
  });
});
