import { authenticatedFetch } from "../lib/authenticated-fetch";

export type LocataireStatut = "actif" | "ancien" | "archive";
export type LocataireStatutModifiable = "actif" | "ancien";

export interface Locataire {
  id: string;
  nom: string;
  prenom: string;
  email: string | null;
  telephone: string | null;
  statut: LocataireStatut;
  anonymiseLe: string | null;
}

export interface CreateLocataireInput {
  nom: string;
  prenom: string;
  email?: string;
  telephone?: string;
}

export interface UpdateLocataireInput {
  nom?: string;
  prenom?: string;
  email?: string;
  telephone?: string;
  statut?: LocataireStatutModifiable;
}

export type BailTypeBail = "vide" | "meuble";
export type BailStatut = "brouillon" | "actif" | "preavis" | "resilie" | "archive";

export interface Bail {
  id: string;
  appartementId: string;
  typeBail: BailTypeBail;
  statut: BailStatut;
  loyerMensuel: string | null;
  depotGarantie: string | null;
  dateDebut: string;
  dateFin: string | null;
}

export interface CreateBailInput {
  appartementId: string;
  typeBail: BailTypeBail;
  dateDebut: string;
  dateFin?: string;
  loyerMensuel?: string;
  depotGarantie?: string;
}

export interface UpdateBailInput {
  typeBail?: BailTypeBail;
  dateDebut?: string;
  dateFin?: string;
  loyerMensuel?: string;
  depotGarantie?: string;
}

export type GarantTypeGarantie = "personne_physique" | "garantie_visale" | "autre";

export interface Garant {
  id: string;
  bailId: string;
  nom: string;
  prenom: string;
  email: string | null;
  telephone: string | null;
  typeGarantie: GarantTypeGarantie;
  archivedAt: string | null;
}

export interface CreateGarantInput {
  bailId: string;
  nom: string;
  prenom: string;
  email?: string;
  telephone?: string;
  typeGarantie: GarantTypeGarantie;
}

export type BailLocataireRole = "titulaire" | "colocataire";

export interface BailLocataire {
  id: string;
  bailId: string;
  locataireId: string;
  role: BailLocataireRole;
  archivedAt: string | null;
}

export interface CreateBailLocataireInput {
  bailId: string;
  locataireId: string;
  role: BailLocataireRole;
}

export function listLocataires(): Promise<Locataire[]> {
  return authenticatedFetch<Locataire[]>("/locataires");
}

export function getLocataire(id: string): Promise<Locataire> {
  return authenticatedFetch<Locataire>(`/locataires/${id}`);
}

export function createLocataire(input: CreateLocataireInput): Promise<Locataire> {
  return authenticatedFetch<Locataire>("/locataires", { method: "POST", body: JSON.stringify(input) });
}

export function updateLocataire(id: string, input: UpdateLocataireInput): Promise<Locataire> {
  return authenticatedFetch<Locataire>(`/locataires/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function archiveLocataire(id: string): Promise<Locataire> {
  return authenticatedFetch<Locataire>(`/locataires/${id}/archiver`, { method: "PATCH" });
}

export function listBaux(filters: { appartementId?: string } = {}): Promise<Bail[]> {
  const params = new URLSearchParams();
  if (filters.appartementId) params.set("appartementId", filters.appartementId);
  const query = params.toString();
  return authenticatedFetch<Bail[]>(`/baux${query ? `?${query}` : ""}`);
}

export function getBail(id: string): Promise<Bail> {
  return authenticatedFetch<Bail>(`/baux/${id}`);
}

export function createBail(input: CreateBailInput): Promise<Bail> {
  return authenticatedFetch<Bail>("/baux", { method: "POST", body: JSON.stringify(input) });
}

export function updateBail(id: string, input: UpdateBailInput): Promise<Bail> {
  return authenticatedFetch<Bail>(`/baux/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function activerBail(id: string): Promise<Bail> {
  return authenticatedFetch<Bail>(`/baux/${id}/activer`, { method: "PATCH" });
}

export function resilierBail(id: string, dateFin?: string): Promise<Bail> {
  return authenticatedFetch<Bail>(`/baux/${id}/resilier`, {
    method: "PATCH",
    body: JSON.stringify(dateFin ? { dateFin } : {})
  });
}

export function archiveBail(id: string): Promise<Bail> {
  return authenticatedFetch<Bail>(`/baux/${id}/archiver`, { method: "PATCH" });
}

export function listGarants(bailId: string): Promise<Garant[]> {
  return authenticatedFetch<Garant[]>(`/garants?bailId=${encodeURIComponent(bailId)}`);
}

export function createGarant(input: CreateGarantInput): Promise<Garant> {
  return authenticatedFetch<Garant>("/garants", { method: "POST", body: JSON.stringify(input) });
}

export function archiveGarant(id: string): Promise<Garant> {
  return authenticatedFetch<Garant>(`/garants/${id}/archiver`, { method: "PATCH" });
}

export function listBailLocataires(
  filters: { bailId?: string; locataireId?: string } = {}
): Promise<BailLocataire[]> {
  const params = new URLSearchParams();
  if (filters.bailId) params.set("bailId", filters.bailId);
  if (filters.locataireId) params.set("locataireId", filters.locataireId);
  const query = params.toString();
  return authenticatedFetch<BailLocataire[]>(`/bail-locataires${query ? `?${query}` : ""}`);
}

export function createBailLocataire(input: CreateBailLocataireInput): Promise<BailLocataire> {
  return authenticatedFetch<BailLocataire>("/bail-locataires", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function archiveBailLocataire(id: string): Promise<BailLocataire> {
  return authenticatedFetch<BailLocataire>(`/bail-locataires/${id}/archiver`, { method: "PATCH" });
}
