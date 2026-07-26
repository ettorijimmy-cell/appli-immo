import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authEvents, TOKEN_STORAGE_KEY, UNAUTHORIZED_EVENT } from "../auth/auth-events";
import { ApiError, authenticatedFetch } from "./authenticated-fetch";

function createLocalStorageStub(initial: Record<string, string> = {}): Storage {
  const store: Record<string, string> = { ...initial };
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) {
        delete store[key];
      }
    },
    key: () => null,
    length: Object.keys(store).length
  } as Storage;
}

describe("authenticatedFetch", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", createLocalStorageStub());
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ajoute le token Bearer depuis localStorage quand présent", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "un-token");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await authenticatedFetch("/scis");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer un-token");
  });

  it("n'ajoute pas d'en-tête Authorization sans token", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await authenticatedFetch("/scis");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.has("Authorization")).toBe(false);
  });

  it("lève une ApiError sur une réponse non-ok", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));

    await expect(authenticatedFetch("/scis")).rejects.toBeInstanceOf(ApiError);
  });

  it("retourne le JSON parsé sur succès", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "1" }), { status: 200 }));

    await expect(authenticatedFetch("/scis/1")).resolves.toEqual({ id: "1" });
  });

  it("sur 401 : purge le token stocké et émet l'évènement de déconnexion", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "token-mort");
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    const listener = vi.fn();
    authEvents.addEventListener(UNAUTHORIZED_EVENT, listener);

    await expect(authenticatedFetch("/scis")).rejects.toBeInstanceOf(ApiError);

    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);

    authEvents.removeEventListener(UNAUTHORIZED_EVENT, listener);
  });
});
