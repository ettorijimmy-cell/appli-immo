import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/authenticated-fetch";
import { messageErreurCartePdf } from "./message-erreur-carte-pdf";

describe("messageErreurCartePdf", () => {
  it("affiche le message métier renvoyé par le backend (ApiError exploitable)", () => {
    const erreur = new ApiError(422, "Impossible de produire le document : une image de signature est introuvable.");
    expect(messageErreurCartePdf(erreur, "Repli jamais utilisé ici")).toBe(
      "Impossible de produire le document : une image de signature est introuvable."
    );
  });

  it("retombe sur le message par défaut quand le backend renvoie le message générique NestJS", () => {
    const erreur = new ApiError(500, "Internal server error");
    expect(messageErreurCartePdf(erreur, "Une erreur est survenue lors de la production du PDF.")).toBe(
      "Une erreur est survenue lors de la production du PDF."
    );
  });

  it("retombe sur le message par défaut pour une erreur qui n'est pas une ApiError (réseau, etc.)", () => {
    expect(messageErreurCartePdf(new TypeError("fetch failed"), "Une erreur est survenue lors de la production du PDF.")).toBe(
      "Une erreur est survenue lors de la production du PDF."
    );
  });

  it("retombe sur le message par défaut quand l'ApiError n'a aucun message exploitable", () => {
    const erreur = new ApiError(500, "");
    expect(messageErreurCartePdf(erreur, "Une erreur est survenue lors de la production du PDF.")).toBe(
      "Une erreur est survenue lors de la production du PDF."
    );
  });
});
