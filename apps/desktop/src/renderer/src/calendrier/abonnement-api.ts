import { authenticatedFetch } from "../lib/authenticated-fetch";

export interface CalendrierAbonnement {
  id: string;
  jeton: string;
  organisationId: string;
}

export function obtenirAbonnementCalendrier(): Promise<CalendrierAbonnement | null> {
  return authenticatedFetch<CalendrierAbonnement | null>("/calendrier-abonnement");
}

export function regenererJetonCalendrier(): Promise<CalendrierAbonnement> {
  return authenticatedFetch<CalendrierAbonnement>("/calendrier-abonnement/regenerer", { method: "POST" });
}
