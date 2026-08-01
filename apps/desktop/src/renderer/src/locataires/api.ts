import { authenticatedFetch } from "../lib/authenticated-fetch";

export type LocataireStatut = "actif" | "ancien" | "archive";
export type LocataireStatutModifiable = "actif" | "ancien";

export interface Locataire {
  id: string;
  nom: string;
  prenom: string;
  email: string | null;
  telephone: string | null;
  adresse: string | null;
  codePostal: string | null;
  ville: string | null;
  dateNaissance: string | null;
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
  adresse?: string;
  codePostal?: string;
  ville?: string;
  dateNaissance?: string;
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
  provisionsCharges: string | null;
  jourEcheance: number | null;
  dateDebut: string;
  dateFin: string | null;
  // Référence pour le régime de clause résolutoire et la mention "Fait
  // à..., le" du document généré — repli sur dateDebut si absente
  // (docs/data-dictionary.md).
  dateSignature: string | null;
  // Posée une seule fois par resilier(), jamais modifiée ensuite (voir
  // packages/db/src/schema/baux.ts). NULL pour les baux résiliés avant
  // l'introduction de cette colonne (docs/data-dictionary.md) — dans ce
  // cas legacy uniquement, se replier sur updatedAt pour départager
  // plusieurs baux résiliés sur le même appartement.
  dateResiliation: string | null;
  updatedAt: string;
}

export interface CreateBailInput {
  appartementId: string;
  typeBail: BailTypeBail;
  dateDebut: string;
  dateFin?: string;
  dateSignature?: string;
  loyerMensuel?: string;
  depotGarantie?: string;
  provisionsCharges?: string;
  jourEcheance?: number;
}

export interface UpdateBailInput {
  typeBail?: BailTypeBail;
  dateDebut?: string;
  dateFin?: string;
  dateSignature?: string;
  loyerMensuel?: string;
  depotGarantie?: string;
  provisionsCharges?: string;
  jourEcheance?: number;
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
  dateNaissance: string | null;
  lieuNaissance: string | null;
  nationalite: string | null;
  archivedAt: string | null;
}

export interface CreateGarantInput {
  bailId: string;
  nom: string;
  prenom: string;
  email?: string;
  telephone?: string;
  typeGarantie: GarantTypeGarantie;
  dateNaissance?: string;
  lieuNaissance?: string;
  nationalite?: string;
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

export interface TropPercu {
  paiementId: string;
  montant: string;
}

// Trop-perçu signalé (jamais écrit en base ici, docs/data-dictionary.md,
// section "versements & remboursements") : reste visible durablement sur
// le Tableau de bord ("Remboursements en attente") tant qu'aucun
// remboursement ne le couvre — pas seulement au moment de cet appel.
export function resilierBail(id: string, dateFin?: string): Promise<Bail & { tropPercu: TropPercu | null }> {
  return authenticatedFetch<Bail & { tropPercu: TropPercu | null }>(`/baux/${id}/resilier`, {
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
