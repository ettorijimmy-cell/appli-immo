import { ApiError, authenticatedFetch } from "../lib/authenticated-fetch";
import { API_BASE_URL } from "../lib/api-config";

export interface LoginResponse {
  accessToken: string;
}

// Requête volontairement distincte de authenticatedFetch/requeteAuthentifiee
// (voir lib/authenticated-fetch.ts) : celle-ci purge le token stocké et émet
// UNAUTHORIZED_EVENT sur un 401, un comportement pensé pour une session déjà
// active qui expire — pas pour une simple tentative de connexion ratée, qui
// n'a jamais eu de session à purger.
//
// Message affiché distingué selon la cause réelle (voir docs/error-log.md,
// [2026-09-27] : un 500 masqué en "Identifiants invalides" avait pointé le
// diagnostic dans la mauvaise direction) : un 401 est un vrai rejet
// d'identifiants, tout autre statut HTTP est une panne côté serveur, et une
// erreur de fetch elle-même (TypeError, jamais de Response reçue) signale
// que le serveur n'a même pas été atteint.
export async function loginRequest(email: string, password: string): Promise<LoginResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
  } catch {
    throw new Error("Impossible de contacter le serveur, vérifie ta connexion.");
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new ApiError(response.status, "Identifiants invalides");
    }
    throw new ApiError(response.status, "Le serveur est momentanément indisponible, réessaie dans quelques instants.");
  }

  return (await response.json()) as LoginResponse;
}

export interface PowerSyncCredentialsResponse {
  token: string;
  endpoint: string;
}

// Jeton distinct du JWT applicatif — voir apps/backend/src/powersync.
// Transmis au processus principal (window.api.powersync.connect), où
// tourne le SDK Node PowerSync, pas ici dans le renderer.
export function fetchPowerSyncCredentials(): Promise<PowerSyncCredentialsResponse> {
  return authenticatedFetch<PowerSyncCredentialsResponse>("/powersync/token");
}
