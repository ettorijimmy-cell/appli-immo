import { authenticatedFetch } from "../lib/authenticated-fetch";

export type RegimeFiscal = "IS" | "IR";

export interface Sci {
  id: string;
  nom: string;
  regimeFiscal: RegimeFiscal;
  formeJuridique: string | null;
  siret: string | null;
  statut: "active" | "archive";
}

export interface CreateSciInput {
  nom: string;
  regimeFiscal: RegimeFiscal;
  formeJuridique?: string;
  siret?: string;
}

export interface UpdateSciInput {
  nom?: string;
  regimeFiscal?: RegimeFiscal;
  formeJuridique?: string;
  siret?: string;
}

export interface CompteBancaire {
  id: string;
  sciId: string;
  iban: string;
  bic: string;
}

export interface CreateCompteBancaireInput {
  sciId: string;
  iban: string;
  bic: string;
}

export function listScis(): Promise<Sci[]> {
  return authenticatedFetch<Sci[]>("/scis");
}

export function getSci(id: string): Promise<Sci> {
  return authenticatedFetch<Sci>(`/scis/${id}`);
}

export function createSci(input: CreateSciInput): Promise<Sci> {
  return authenticatedFetch<Sci>("/scis", { method: "POST", body: JSON.stringify(input) });
}

export function updateSci(id: string, input: UpdateSciInput): Promise<Sci> {
  return authenticatedFetch<Sci>(`/scis/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function archiveSci(id: string): Promise<Sci> {
  return authenticatedFetch<Sci>(`/scis/${id}/archiver`, { method: "PATCH" });
}

// Seul point de lecture de l'IBAN/BIC : toujours déchiffré côté
// apps/backend, jamais côté Electron (CLAUDE.md, Règles importantes).
export function listComptesBancaires(sciId: string): Promise<CompteBancaire[]> {
  return authenticatedFetch<CompteBancaire[]>(`/scis/${sciId}/comptes-bancaires`);
}

export function createCompteBancaire(
  input: CreateCompteBancaireInput
): Promise<{ id: string; sciId: string }> {
  return authenticatedFetch("/comptes-bancaires-sci", {
    method: "POST",
    body: JSON.stringify(input)
  });
}
