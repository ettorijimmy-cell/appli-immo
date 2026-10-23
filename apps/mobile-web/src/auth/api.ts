import { ApiError } from "../lib/authenticated-fetch";
import { API_BASE_URL } from "../lib/api-config";

export interface LoginResponse {
  accessToken: string;
}

// Même principe que apps/desktop/src/renderer/src/auth/api.ts (voir ce
// fichier) : un 401 est un vrai rejet d'identifiants, un 429 une
// limitation de tentatives (voir apps/backend/src/auth/limitation-
// tentatives-connexion.service.ts), tout autre statut HTTP une panne
// côté serveur, et une erreur de fetch elle-même (TypeError, jamais de
// Response reçue) signale que le serveur n'a même pas été atteint.
// Avant cette distinction, toute erreur affichait "Identifiants
// invalides" sans nuance — trompeur en particulier sur un 429, qui
// inciterait à retaper le mot de passe et alimenterait encore le blocage.

const MINUTES_REPLI_PAR_DEFAUT = 15;

// Retry-After (RFC 9110 §10.2.3, en secondes) d'abord, le champ
// retryAfterSeconds du corps JSON renvoyé par TropDeTentativesConnexionFilter
// en repli (même valeur — utile si un intermédiaire réseau retirait
// l'en-tête), puis 15 minutes si aucun des deux n'est exploitable : jamais
// un message sans délai affiché.
export function minutesAvantNouvelleTentative(enteteRetryAfter: string | null, corpsRetryAfterSeconds: unknown): number {
  const secondesHeader = enteteRetryAfter !== null ? Number(enteteRetryAfter) : NaN;
  if (Number.isFinite(secondesHeader) && secondesHeader > 0) {
    return Math.ceil(secondesHeader / 60);
  }
  const secondesCorps = typeof corpsRetryAfterSeconds === "number" ? corpsRetryAfterSeconds : NaN;
  if (Number.isFinite(secondesCorps) && secondesCorps > 0) {
    return Math.ceil(secondesCorps / 60);
  }
  return MINUTES_REPLI_PAR_DEFAUT;
}

function messageTropDeTentatives(minutes: number): string {
  return `Trop de tentatives de connexion. Réessayez dans ${minutes} minute${minutes > 1 ? "s" : ""}.`;
}

export async function loginRequest(email: string, password: string): Promise<LoginResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
  } catch {
    throw new Error("Impossible de contacter le serveur, vérifiez votre connexion.");
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new ApiError(response.status, "Identifiants invalides");
    }
    if (response.status === 429) {
      const corps = await response.json().catch(() => undefined);
      const minutes = minutesAvantNouvelleTentative(
        response.headers.get("Retry-After"),
        (corps as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds
      );
      throw new ApiError(response.status, messageTropDeTentatives(minutes));
    }
    throw new ApiError(response.status, "Le serveur est momentanément indisponible, réessayez dans quelques instants.");
  }

  return (await response.json()) as LoginResponse;
}
