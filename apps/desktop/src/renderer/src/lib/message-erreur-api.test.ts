import { describe, expect, it } from "vitest";
import { ApiError } from "./authenticated-fetch";
import { messageErreurApi } from "./message-erreur-api";

describe("messageErreurApi", () => {
  it("affiche le message métier renvoyé par le backend (ApiError exploitable)", () => {
    const erreur = new ApiError(422, "Impossible de produire le document : une image de signature est introuvable.");
    expect(messageErreurApi(erreur, "Repli jamais utilisé ici")).toBe(
      "Impossible de produire le document : une image de signature est introuvable."
    );
  });

  it("affiche le refus métier d'un archivage (409) tel quel", () => {
    const erreur = new ApiError(409, "Un bail actif ou en préavis doit d'abord être résilié avant d'être archivé.");
    expect(messageErreurApi(erreur, "Impossible d'archiver.")).toBe(
      "Un bail actif ou en préavis doit d'abord être résilié avant d'être archivé."
    );
  });

  it("retombe sur le message par défaut quand le backend renvoie le message générique NestJS", () => {
    const erreur = new ApiError(500, "Internal server error");
    expect(messageErreurApi(erreur, "Une erreur est survenue lors de la production du PDF.")).toBe(
      "Une erreur est survenue lors de la production du PDF."
    );
  });

  it("retombe sur le message par défaut pour une erreur qui n'est pas une ApiError (réseau, etc.)", () => {
    expect(messageErreurApi(new TypeError("fetch failed"), "Une erreur est survenue lors de la production du PDF.")).toBe(
      "Une erreur est survenue lors de la production du PDF."
    );
  });

  it("retombe sur le message par défaut quand l'ApiError n'a aucun message exploitable", () => {
    const erreur = new ApiError(500, "");
    expect(messageErreurApi(erreur, "Une erreur est survenue lors de la production du PDF.")).toBe(
      "Une erreur est survenue lors de la production du PDF."
    );
  });

  it("retombe sur le message par défaut pour une valeur rejetée qui n'est pas une erreur", () => {
    expect(messageErreurApi("refus", "Repli")).toBe("Repli");
  });
});
