import { authenticatedFetch } from "../lib/authenticated-fetch";

export interface Immeuble {
  id: string;
  sciId: string;
  nom: string;
  adresse: string;
  codePostal: string | null;
  ville: string | null;
  statut: "actif" | "archive";
}

export interface CreateImmeubleInput {
  sciId: string;
  nom: string;
  adresse: string;
  codePostal?: string;
  ville?: string;
}

export interface UpdateImmeubleInput {
  nom?: string;
  adresse?: string;
  codePostal?: string;
  ville?: string;
}

export type AppartementType = "T1" | "T2" | "T3" | "T4" | "T5+";
export type AppartementStatut = "vacant" | "loue" | "travaux" | "archive";

export interface Appartement {
  id: string;
  immeubleId: string;
  numero: string;
  type: AppartementType;
  surface: string | null;
  loyerReference: string | null;
  statut: AppartementStatut;
}

export interface CreateAppartementInput {
  immeubleId: string;
  numero: string;
  type: AppartementType;
  surface?: string;
  loyerReference?: string;
}

export type AppartementStatutModifiable = "vacant" | "loue" | "travaux";

export interface UpdateAppartementInput {
  numero?: string;
  type?: AppartementType;
  surface?: string;
  loyerReference?: string;
  statut?: AppartementStatutModifiable;
}

export type EquipementType = "chaudiere" | "ballon_eau_chaude" | "autre";

export interface Equipement {
  id: string;
  appartementId: string;
  type: EquipementType;
  dateDernierEntretien: string | null;
  // Périodicité attendue en mois. Absent = pas d'alerte entretien_equipement
  // (Module 6) pour cet équipement, voir data-dictionary.md.
  intervalleEntretienMois: number | null;
  // Pas de `statut` dédié pour les équipements (voir data-dictionary.md) :
  // archivedAt seul indique l'archivage.
  archivedAt: string | null;
}

export interface CreateEquipementInput {
  appartementId: string;
  type: EquipementType;
  dateDernierEntretien?: string;
  intervalleEntretienMois?: number;
}

export interface UpdateEquipementInput {
  type?: EquipementType;
  dateDernierEntretien?: string;
  intervalleEntretienMois?: number;
}

export function listImmeubles(sciId: string): Promise<Immeuble[]> {
  return authenticatedFetch<Immeuble[]>(`/immeubles?sciId=${encodeURIComponent(sciId)}`);
}

export function getImmeuble(id: string): Promise<Immeuble> {
  return authenticatedFetch<Immeuble>(`/immeubles/${id}`);
}

export function createImmeuble(input: CreateImmeubleInput): Promise<Immeuble> {
  return authenticatedFetch<Immeuble>("/immeubles", { method: "POST", body: JSON.stringify(input) });
}

export function updateImmeuble(id: string, input: UpdateImmeubleInput): Promise<Immeuble> {
  return authenticatedFetch<Immeuble>(`/immeubles/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function archiveImmeuble(id: string): Promise<Immeuble> {
  return authenticatedFetch<Immeuble>(`/immeubles/${id}/archiver`, { method: "PATCH" });
}

export function listAppartements(immeubleId: string): Promise<Appartement[]> {
  return authenticatedFetch<Appartement[]>(
    `/appartements?immeubleId=${encodeURIComponent(immeubleId)}`
  );
}

export function getAppartement(id: string): Promise<Appartement> {
  return authenticatedFetch<Appartement>(`/appartements/${id}`);
}

export function createAppartement(input: CreateAppartementInput): Promise<Appartement> {
  return authenticatedFetch<Appartement>("/appartements", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateAppartement(id: string, input: UpdateAppartementInput): Promise<Appartement> {
  return authenticatedFetch<Appartement>(`/appartements/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function archiveAppartement(id: string): Promise<Appartement> {
  return authenticatedFetch<Appartement>(`/appartements/${id}/archiver`, { method: "PATCH" });
}

export function listEquipements(appartementId: string): Promise<Equipement[]> {
  return authenticatedFetch<Equipement[]>(
    `/equipements?appartementId=${encodeURIComponent(appartementId)}`
  );
}

export function createEquipement(input: CreateEquipementInput): Promise<Equipement> {
  return authenticatedFetch<Equipement>("/equipements", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateEquipement(id: string, input: UpdateEquipementInput): Promise<Equipement> {
  return authenticatedFetch<Equipement>(`/equipements/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function archiveEquipement(id: string): Promise<Equipement> {
  return authenticatedFetch<Equipement>(`/equipements/${id}/archiver`, { method: "PATCH" });
}
