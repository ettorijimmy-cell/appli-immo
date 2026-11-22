import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messageErreurApi } from "../lib/message-erreur-api";
import { createRemboursement } from "./api";

// Petites suites, compléments de la décision 3 (2026-11-22) : le backend
// refuse un remboursement de trop-perçu à 0 € (400, BadRequestException
// métier, message en chaîne). Les deux formulaires qui l'envoient
// (BailTabs.NewRemboursementTropPercuForm et
// RemboursementsEnAttenteView.RemboursementForm) affichent
// messageErreurApi(erreur, "Impossible de créer le remboursement") : ce
// test vérifie la chaîne complète réponse 400 -> createRemboursement ->
// messageErreurApi, sans rendu de composant (l'environnement de test
// desktop est "node").
const MESSAGE_BACKEND =
  "Montant invalide pour « montant remboursé » : un remboursement de trop-perçu doit être supérieur à 0 €. Un montant remboursé de 0 € n'est possible que pour une retenue totale sur le dépôt de garantie.";

describe("remboursement de trop-perçu à 0 € refusé par le backend", () => {
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

  it("le formulaire affiche le message du serveur, pas le texte générique", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ statusCode: 400, message: MESSAGE_BACKEND, error: "Bad Request" }), {
        status: 400
      })
    );

    const erreur = await createRemboursement({
      bailId: "bail",
      paiementId: "paiement",
      type: "trop_percu",
      montantOrigine: "300.00",
      montantRembourse: "0",
      dateRemboursement: "2026-07-01",
      mode: "virement"
    }).catch((e: unknown) => e);

    expect(messageErreurApi(erreur, "Impossible de créer le remboursement")).toBe(MESSAGE_BACKEND);
  });
});
