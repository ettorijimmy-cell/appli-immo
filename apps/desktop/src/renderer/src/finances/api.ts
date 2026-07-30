import { authenticatedFetch } from "../lib/authenticated-fetch";

export type PaiementType = "loyer" | "charges" | "depot_garantie";
export type PaiementMode = "virement" | "cheque" | "especes" | "caf";
export type PaiementStatut = "paye" | "impaye" | "partiel";

// montant_paye/mode/date_paiement/reference_rapprochement ont quitté ce
// type : un paiement peut désormais recevoir plusieurs versements (voir
// Versement ci-dessous) — docs/data-dictionary.md, section "versements &
// remboursements".
export interface Paiement {
  id: string;
  bailId: string;
  type: PaiementType;
  statut: PaiementStatut;
  montant: string;
  dateEcheance: string;
  archivedAt: string | null;
}

export interface CreatePaiementInput {
  bailId: string;
  type: PaiementType;
  montant: string;
  dateEcheance: string;
}

export interface UpdatePaiementInput {
  type?: PaiementType;
  montant?: string;
  dateEcheance?: string;
}

export interface Versement {
  id: string;
  paiementId: string;
  montant: string;
  dateVersement: string;
  mode: PaiementMode;
  referenceRapprochement: string | null;
  archivedAt: string | null;
}

export interface AjouterVersementInput {
  paiementId: string;
  montant: string;
  mode: PaiementMode;
  dateVersement: string;
  referenceRapprochement?: string;
}

export type RemboursementType = "trop_percu" | "depot_garantie";

export interface Remboursement {
  id: string;
  bailId: string;
  paiementId: string | null;
  type: RemboursementType;
  montantOrigine: string;
  montantRembourse: string;
  commentaire: string | null;
  dateRemboursement: string;
  mode: PaiementMode;
  archivedAt: string | null;
}

export interface CreateRemboursementInput {
  bailId: string;
  paiementId?: string;
  type: RemboursementType;
  montantOrigine: string;
  montantRembourse: string;
  commentaire?: string;
  dateRemboursement: string;
  mode: PaiementMode;
}

export type CritereCorrespondance = "montant" | "date" | "reference";

export interface LigneReleveCsv {
  id: string;
  date: string;
  montant: string;
  libelle: string;
}

export interface CandidatRapprochement {
  paiementId: string;
  criteresCorrespondants: CritereCorrespondance[];
}

export interface PropositionRapprochement {
  ligneCsvId: string;
  candidats: CandidatRapprochement[];
}

export interface RapprocherCsvResult {
  lignes: LigneReleveCsv[];
  propositions: PropositionRapprochement[];
  paiements: Paiement[];
}

export function listPaiements(filters: { bailId?: string } = {}): Promise<Paiement[]> {
  const params = new URLSearchParams();
  if (filters.bailId) params.set("bailId", filters.bailId);
  const query = params.toString();
  return authenticatedFetch<Paiement[]>(`/paiements${query ? `?${query}` : ""}`);
}

export function getPaiement(id: string): Promise<Paiement> {
  return authenticatedFetch<Paiement>(`/paiements/${id}`);
}

export function createPaiement(input: CreatePaiementInput): Promise<Paiement> {
  return authenticatedFetch<Paiement>("/paiements", { method: "POST", body: JSON.stringify(input) });
}

export function updatePaiement(id: string, input: UpdatePaiementInput): Promise<Paiement> {
  return authenticatedFetch<Paiement>(`/paiements/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function archivePaiement(id: string): Promise<Paiement> {
  return authenticatedFetch<Paiement>(`/paiements/${id}/archiver`, { method: "PATCH" });
}

export function rapprocherCsv(contenuCsv: string): Promise<RapprocherCsvResult> {
  return authenticatedFetch<RapprocherCsvResult>("/paiements/rapprocher-csv", {
    method: "POST",
    body: JSON.stringify({ contenuCsv })
  });
}

export function listVersements(filters: { paiementId?: string } = {}): Promise<Versement[]> {
  const params = new URLSearchParams();
  if (filters.paiementId) params.set("paiementId", filters.paiementId);
  const query = params.toString();
  return authenticatedFetch<Versement[]>(`/versements${query ? `?${query}` : ""}`);
}

export function ajouterVersement(input: AjouterVersementInput): Promise<Versement> {
  return authenticatedFetch<Versement>("/versements", { method: "POST", body: JSON.stringify(input) });
}

export function annulerVersement(id: string): Promise<Versement> {
  return authenticatedFetch<Versement>(`/versements/${id}/annuler`, { method: "PATCH" });
}

export function listRemboursements(filters: { bailId?: string } = {}): Promise<Remboursement[]> {
  const params = new URLSearchParams();
  if (filters.bailId) params.set("bailId", filters.bailId);
  const query = params.toString();
  return authenticatedFetch<Remboursement[]>(`/remboursements${query ? `?${query}` : ""}`);
}

export function createRemboursement(input: CreateRemboursementInput): Promise<Remboursement> {
  return authenticatedFetch<Remboursement>("/remboursements", { method: "POST", body: JSON.stringify(input) });
}

export function archiveRemboursement(id: string): Promise<Remboursement> {
  return authenticatedFetch<Remboursement>(`/remboursements/${id}/archiver`, { method: "PATCH" });
}
