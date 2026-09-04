import { authenticatedFetch } from "../lib/authenticated-fetch";

export interface StatutGmail {
  connecte: boolean;
  emailCompte: string | null;
}

// Pas de polling (voir apps/backend/src/google-oauth/google-oauth.controller.ts,
// GET /gmail/statut) — appelé uniquement au chargement de l'écran
// Paramètres, ou manuellement après un aller-retour dans le navigateur
// système pour le consentement.
export function obtenirStatutGmail(): Promise<StatutGmail> {
  return authenticatedFetch<StatutGmail>("/gmail/statut");
}

export function obtenirUrlConsentementGmail(): Promise<{ url: string }> {
  return authenticatedFetch<{ url: string }>("/gmail/url-consentement");
}
