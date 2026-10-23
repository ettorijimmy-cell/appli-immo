import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/authenticated-fetch";
import { loginRequest, minutesAvantNouvelleTentative } from "./api";

describe("minutesAvantNouvelleTentative", () => {
  it("arrondit l'en-tête Retry-After (secondes) à la minute supérieure", () => {
    expect(minutesAvantNouvelleTentative("61", undefined)).toBe(2);
    expect(minutesAvantNouvelleTentative("60", undefined)).toBe(1);
    expect(minutesAvantNouvelleTentative("900", undefined)).toBe(15);
  });

  it("retombe sur retryAfterSeconds du corps si l'en-tête est absent", () => {
    expect(minutesAvantNouvelleTentative(null, 125)).toBe(3);
  });

  it("l'en-tête a priorité sur le corps quand les deux sont présents", () => {
    expect(minutesAvantNouvelleTentative("60", 900)).toBe(1);
  });

  it("retombe sur 15 minutes si l'en-tête et le corps sont absents ou invalides", () => {
    expect(minutesAvantNouvelleTentative(null, undefined)).toBe(15);
    expect(minutesAvantNouvelleTentative("pas-un-nombre", "pas-un-nombre")).toBe(15);
    expect(minutesAvantNouvelleTentative("0", 0)).toBe(15);
    expect(minutesAvantNouvelleTentative("-5", -5)).toBe(15);
  });
});

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
      message: "Le serveur est momentanément indisponible, réessayez dans quelques instants."
    });
  });

  it("sur échec réseau (fetch qui lève, aucune réponse reçue) : message distinct d'un problème d'identifiants ou de serveur", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(loginRequest("jimmy@example.com", "peu-importe")).rejects.toMatchObject({
      message: "Impossible de contacter le serveur, vérifiez votre connexion."
    });
  });

  it("sur succès (200) : renvoie le accessToken", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ accessToken: "un-jwt" }), { status: 200 }));

    await expect(loginRequest("jimmy@example.com", "bon-mot-de-passe")).resolves.toEqual({ accessToken: "un-jwt" });
  });

  it("sur 429 : lève une ApiError avec le délai tiré de l'en-tête Retry-After", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "Trop de tentatives de connexion. Réessayez plus tard.", retryAfterSeconds: 900 }), {
        status: 429,
        headers: { "Retry-After": "120" }
      })
    );

    await expect(loginRequest("jimmy@example.com", "faux")).rejects.toMatchObject({
      status: 429,
      message: "Trop de tentatives de connexion. Réessayez dans 2 minutes."
    });
  });

  it("sur 429 sans en-tête Retry-After : utilise retryAfterSeconds du corps", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "Trop de tentatives de connexion. Réessayez plus tard.", retryAfterSeconds: 90 }), {
        status: 429
      })
    );

    await expect(loginRequest("jimmy@example.com", "faux")).rejects.toMatchObject({
      status: 429,
      message: "Trop de tentatives de connexion. Réessayez dans 2 minutes."
    });
  });

  it("sur 429 sans en-tête ni corps exploitable : retombe sur 15 minutes", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 429 }));

    await expect(loginRequest("jimmy@example.com", "faux")).rejects.toMatchObject({
      status: 429,
      message: "Trop de tentatives de connexion. Réessayez dans 15 minutes."
    });
  });
});
