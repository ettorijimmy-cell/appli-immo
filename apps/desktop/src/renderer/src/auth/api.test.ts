import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/authenticated-fetch";
import { loginRequest } from "./api";

describe("loginRequest", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sur 401 : lève une ApiError avec le message 'Identifiants invalides'", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ statusCode: 401, message: "Identifiants invalides" }), { status: 401 })
    );

    await expect(loginRequest("jimmy@example.com", "mauvais-mot-de-passe")).rejects.toMatchObject({
      status: 401,
      message: "Identifiants invalides"
    });
    await expect(loginRequest("jimmy@example.com", "mauvais-mot-de-passe")).rejects.toBeInstanceOf(ApiError);
  });

  it("sur 500 : lève une ApiError avec un message de panne serveur, jamais 'Identifiants invalides'", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ statusCode: 500, message: "Internal server error" }), { status: 500 })
    );

    await expect(loginRequest("jimmy@example.com", "bon-mot-de-passe")).rejects.toMatchObject({
      status: 500,
      message: "Le serveur est momentanément indisponible, réessaie dans quelques instants."
    });
  });

  it("sur échec réseau (fetch qui lève, aucune réponse reçue) : message distinct d'un problème d'identifiants ou de serveur", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(loginRequest("jimmy@example.com", "peu-importe")).rejects.toMatchObject({
      message: "Impossible de contacter le serveur, vérifie ta connexion."
    });
  });

  it("sur succès (200) : renvoie le accessToken", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ accessToken: "un-jwt" }), { status: 200 }));

    await expect(loginRequest("jimmy@example.com", "bon-mot-de-passe")).resolves.toEqual({ accessToken: "un-jwt" });
  });
});
