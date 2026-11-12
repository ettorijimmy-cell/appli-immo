import { describe, expect, it, vi } from "vitest";
import { creerActionConfirmee, type EtatActionConfirmee } from "./action-confirmee";
import { ApiError } from "./authenticated-fetch";

const REPLI = "Impossible d'archiver cette photo.";

describe("creerActionConfirmee", () => {
  it("annuler : l'action n'est jamais appelée", () => {
    const action = vi.fn().mockResolvedValue(undefined);
    const confirmation = creerActionConfirmee({ action, messageRepli: REPLI });

    expect(confirmation.annuler()).toBe(true);

    expect(action).not.toHaveBeenCalled();
    expect(confirmation.etat()).toEqual({ statut: "annulee" });
  });

  it("annuler puis confirmer : toujours aucun appel", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    const confirmation = creerActionConfirmee({ action, messageRepli: REPLI });

    confirmation.annuler();

    expect(await confirmation.confirmer()).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it("confirmer : l'action est appelée une fois et la confirmation se termine", async () => {
    const action = vi.fn().mockResolvedValue({ id: "doc-1" });
    const etats: EtatActionConfirmee[] = [];
    const confirmation = creerActionConfirmee({ action, messageRepli: REPLI, surChangement: (e) => etats.push(e) });

    expect(await confirmation.confirmer()).toBe(true);

    expect(action).toHaveBeenCalledTimes(1);
    expect(etats).toEqual([{ statut: "en_cours" }, { statut: "terminee" }]);
  });

  it("rejet ApiError 409 : le message de l'API est affiché tel quel", async () => {
    const refus = "La partie entrée de cet état des lieux est signée : ses photos ne peuvent plus être archivées.";
    const action = vi.fn().mockRejectedValue(new ApiError(409, refus));
    const confirmation = creerActionConfirmee({ action, messageRepli: REPLI });

    expect(await confirmation.confirmer()).toBe(false);

    expect(confirmation.etat()).toEqual({ statut: "echec", message: refus });
  });

  it("erreur réseau : message de repli", async () => {
    const action = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const confirmation = creerActionConfirmee({ action, messageRepli: REPLI });

    await confirmation.confirmer();

    expect(confirmation.etat()).toEqual({ statut: "echec", message: REPLI });
  });

  it("« Internal server error » : message de repli, jamais le générique NestJS", async () => {
    const action = vi.fn().mockRejectedValue(new ApiError(500, "Internal server error"));
    const confirmation = creerActionConfirmee({ action, messageRepli: REPLI });

    await confirmation.confirmer();

    expect(confirmation.etat()).toEqual({ statut: "echec", message: REPLI });
  });

  it("double clic pendant l'appel : une seule exécution", async () => {
    let terminer: () => void = () => undefined;
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          terminer = resolve;
        })
    );
    const confirmation = creerActionConfirmee({ action, messageRepli: REPLI });

    const premier = confirmation.confirmer();
    const second = confirmation.confirmer();
    expect(await second).toBe(false);
    terminer();

    expect(await premier).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("annuler pendant l'appel : refusé, l'action va à son terme", async () => {
    let terminer: () => void = () => undefined;
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          terminer = resolve;
        })
    );
    const confirmation = creerActionConfirmee({ action, messageRepli: REPLI });

    const appel = confirmation.confirmer();
    expect(confirmation.annuler()).toBe(false);
    terminer();

    expect(await appel).toBe(true);
    expect(confirmation.etat()).toEqual({ statut: "terminee" });
  });

  it("après un échec : nouvel essai possible, un appel de plus", async () => {
    const action = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(undefined);
    const confirmation = creerActionConfirmee({ action, messageRepli: REPLI });

    expect(await confirmation.confirmer()).toBe(false);
    expect(await confirmation.confirmer()).toBe(true);

    expect(action).toHaveBeenCalledTimes(2);
  });

  it("après un succès : une nouvelle confirmation ne relance rien", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    const confirmation = creerActionConfirmee({ action, messageRepli: REPLI });

    await confirmation.confirmer();

    expect(await confirmation.confirmer()).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);
  });
});
