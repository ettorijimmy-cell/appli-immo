import { authEvents, TOKEN_STORAGE_KEY, UNAUTHORIZED_EVENT } from "../auth/auth-events";
import { API_BASE_URL } from "./api-config";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message?: string,
    public readonly champsManquants?: string[]
  ) {
    super(message ?? `Requête échouée (${status})`);
  }
}

interface CorpsErreur {
  message?: string | undefined;
  champsManquants?: string[] | undefined;
}

// NestJS renvoie {statusCode, message, error} sur une exception — on
// remonte ce message (ex. "l'appartement n'est pas vacant") plutôt qu'un
// message générique, utile pour les règles métier qui refusent une action
// (activation/résiliation de bail notamment). `champsManquants` est un
// tableau additionnel propre à BadRequestException de la génération de
// bail (voir bail-document-docx.service.ts) — absent de toutes les autres
// réponses d'erreur, donc toujours optionnel ici.
async function extraireCorpsErreur(response: Response): Promise<CorpsErreur> {
  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") {
      return {};
    }
    const { message, champsManquants } = body as { message?: unknown; champsManquants?: unknown };
    return {
      message: typeof message === "string" ? message : undefined,
      champsManquants:
        Array.isArray(champsManquants) && champsManquants.every((champ) => typeof champ === "string")
          ? (champsManquants as string[])
          : undefined
    };
  } catch {
    return {};
  }
}

async function requeteAuthentifiee(path: string, init: RequestInit): Promise<Response> {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  const headers = new Headers(init.headers);
  // FormData (upload de fichier, voir documents/api.ts) : ne jamais fixer
  // Content-Type nous-mêmes — fetch doit poser le boundary multipart lui-même.
  if (!(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
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
    const { message, champsManquants } = await extraireCorpsErreur(response);
    throw new ApiError(response.status, message, champsManquants);
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

// Téléchargement de contenu binaire (Module 4, Documents) — jamais de
// parsing JSON, le corps de la réponse est le fichier déchiffré tel quel
// (voir GET /documents/:id/contenu, apps/backend/src/documents).
export async function authenticatedFetchBlob(
  path: string,
  init: RequestInit = {}
): Promise<{ blob: Blob; nomFichier: string | null; headers: Headers }> {
  const response = await requeteAuthentifiee(path, init);
  const disposition = response.headers.get("Content-Disposition");
  const nomFichier = disposition ? decodeURIComponent(/filename="(.+)"/.exec(disposition)?.[1] ?? "") : null;
  return { blob: await response.blob(), nomFichier: nomFichier || null, headers: response.headers };
}
