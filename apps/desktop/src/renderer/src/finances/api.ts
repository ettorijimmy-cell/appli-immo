import { authenticatedFetch } from "../lib/authenticated-fetch";

export type PaiementType = "loyer" | "charges" | "depot_garantie";
export type PaiementMode = "virement" | "cheque" | "especes" | "caf";
export type PaiementStatut = "paye" | "impaye" | "partiel";

export interface Paiement {
  id: string;
  bailId: string;
  type: PaiementType;
  mode: PaiementMode | null;
  statut: PaiementStatut;
  montant: string;
  montantPaye: string | null;
  dateEcheance: string;
  datePaiement: string | null;
  referenceRapprochement: string | null;
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

export interface EnregistrerPaiementInput {
  montantPaye: string;
  mode: PaiementMode;
  datePaiement: string;
  referenceRapprochement?: string;
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

export function enregistrerPaiement(id: string, input: EnregistrerPaiementInput): Promise<Paiement> {
  return authenticatedFetch<Paiement>(`/paiements/${id}/enregistrer`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function annulerEnregistrementPaiement(id: string): Promise<Paiement> {
  return authenticatedFetch<Paiement>(`/paiements/${id}/annuler-enregistrement`, { method: "PATCH" });
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
