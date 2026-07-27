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

// NestJS renvoie {statusCode, message, error} sur une exception — on
// remonte ce message (ex. "l'appartement n'est pas vacant") plutôt qu'un
// message générique, utile pour les règles métier qui refusent une action
// (activation/résiliation de bail notamment).
async function extraireMessageErreur(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "message" in body) {
      const { message } = body as { message: unknown };
      return typeof message === "string" ? message : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function authenticatedFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

  if (response.status === 401) {
    // Token mort (expiré ou signé par un secret différent — voir
    // docs/error-log.md) : purge et notifie AuthProvider, qui bascule
    // l'app en état déconnecté (redirection vers l'écran de connexion).
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    authEvents.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }

  if (!response.ok) {
    throw new ApiError(response.status, await extraireMessageErreur(response));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
