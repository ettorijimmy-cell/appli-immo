import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { creerActionConfirmee } from "../lib/action-confirmee";
import { texteArchivageBien, texteArchivageSci } from "../lib/textes-confirmation";
import { archiveSci } from "../scis/api";
import { archiveBien } from "./api";

// Petites suites, décision 5 (commit 4) : le backend refuse d'archiver un
// bien qui a encore des appartements non archivés (ou un bail actif), et une
// SCI qui a encore des biens non archivés (409, message qui dit quoi faire
// d'abord). La modale d'archivage (ConfirmationActionModal →
// creerActionConfirmee) doit afficher ce message, pas le texte de repli.
// Sans rendu de composant (environnement de test desktop "node").
describe("archivage d'un bien ou d'une SCI refusé par le backend : message du serveur dans la modale", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined
    });
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function repondre409(message: string): void {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ statusCode: 409, message, error: "Conflict" }), { status: 409 })
    );
  }

  it("bien : « Archivez d'abord les 3 appartements de ce bien. »", async () => {
    repondre409("Archivez d'abord les 3 appartements de ce bien.");
    const action = creerActionConfirmee({
      action: () => archiveBien("bien"),
      messageRepli: texteArchivageBien({ nom: null, adresse: "12 rue Turgot", proprietaireType: "personne_physique" })
        .messageRepli
    });

    expect(await action.confirmer()).toBe(false);
    expect(action.etat()).toEqual({ statut: "echec", message: "Archivez d'abord les 3 appartements de ce bien." });
  });

  it("SCI : « Archivez d'abord les 2 biens de cette SCI. »", async () => {
    repondre409("Archivez d'abord les 2 biens de cette SCI.");
    const action = creerActionConfirmee({
      action: () => archiveSci("sci"),
      messageRepli: texteArchivageSci({ nom: "SCI Turgot" }).messageRepli
    });

    expect(await action.confirmer()).toBe(false);
    expect(action.etat()).toEqual({ statut: "echec", message: "Archivez d'abord les 2 biens de cette SCI." });
  });
});
