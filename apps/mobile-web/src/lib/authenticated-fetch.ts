import { authEvents, TOKEN_STORAGE_KEY, UNAUTHORIZED_EVENT } from "../auth/auth-events";
import { API_BASE_URL } from "./api-config";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message?: string
  ) {
    super(message ?? `Requête échouée (${status})`);
  }
}

// ValidationPipe (apps/backend/src/main.ts, whitelist+transform) renvoie
// {statusCode: 400, message: string[], error: "Bad Request"} sur une erreur
// de validation de DTO — un tableau, pas une chaîne, contrairement à toute
// autre exception NestJS de ce backend. Sans ce cas, le tableau était
// silencieusement ignoré (typeof !== "string") et l'utilisateur ne voyait
// que le message générique "Requête échouée (400)".
function normaliserMessage(message: unknown): string | undefined {
  if (typeof message === "string") {
    return message;
  }
  if (Array.isArray(message)) {
    const chaines = message.filter((item): item is string => typeof item === "string");
    return chaines.length > 0 ? chaines.join(" ; ") : undefined;
  }
  return undefined;
}

async function extraireMessageErreur(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "message" in body) {
      const { message } = body as { message: unknown };
      return normaliserMessage(message);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function requeteAuthentifiee(path: string, init: RequestInit): Promise<Response> {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  const headers = new Headers(init.headers);
  // FormData (upload de photo) : ne jamais fixer Content-Type nous-mêmes —
  // fetch doit poser le boundary multipart lui-même.
  if (!(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

  if (response.status === 401) {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    authEvents.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }

  if (!response.ok) {
    throw new ApiError(response.status, await extraireMessageErreur(response));
  }
  return response;
}

export async function authenticatedFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await requeteAuthentifiee(path, init);
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
