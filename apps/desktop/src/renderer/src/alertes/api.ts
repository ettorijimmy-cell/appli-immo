import { authenticatedFetch } from "../lib/authenticated-fetch";

export type AlerteType =
  | "bail_fin_proche"
  | "document_expire"
  | "document_expire_proche"
  | "entretien_equipement"
  | "impaye";
export type AlerteStatut = "active" | "traitee" | "ignoree" | "resolue";

export interface Alerte {
  id: string;
  type: AlerteType;
  entiteId: string;
  statut: AlerteStatut;
  message: string;
  dateReference: string;
  archivedAt: string | null;
}

export interface ParametreAlerte {
  id: string;
  type: AlerteType;
  seuilJoursAvant: number;
}

export function listAlertes(filtres: { statut?: AlerteStatut; type?: AlerteType } = {}): Promise<Alerte[]> {
  const params = new URLSearchParams();
  if (filtres.statut) params.set("statut", filtres.statut);
  if (filtres.type) params.set("type", filtres.type);
  const query = params.toString();
  return authenticatedFetch<Alerte[]>(`/alertes${query ? `?${query}` : ""}`);
}

export function traiterAlerte(id: string): Promise<Alerte> {
  return authenticatedFetch<Alerte>(`/alertes/${id}/traiter`, { method: "PATCH" });
}

export function ignorerAlerte(id: string): Promise<Alerte> {
  return authenticatedFetch<Alerte>(`/alertes/${id}/ignorer`, { method: "PATCH" });
}

export function listParametresAlertes(): Promise<ParametreAlerte[]> {
  return authenticatedFetch<ParametreAlerte[]>("/parametres-alertes");
}

export function updateParametreAlerte(type: AlerteType, seuilJoursAvant: number): Promise<ParametreAlerte> {
  return authenticatedFetch<ParametreAlerte>(`/parametres-alertes/${type}`, {
    method: "PATCH",
    body: JSON.stringify({ seuilJoursAvant })
  });
}
