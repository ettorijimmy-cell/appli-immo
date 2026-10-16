import { authenticatedFetch } from "../lib/authenticated-fetch";

export type RegimeFiscal = "IS" | "IR";

export interface Sci {
  id: string;
  nom: string;
  regimeFiscal: RegimeFiscal;
  formeJuridique: string | null;
  siret: string | null;
  adresse: string | null;
  codePostal: string | null;
  ville: string | null;
  telephone: string | null;
  // null = non renseigné, distinct de false — ne jamais pré-remplir
  // automatiquement (docs/data-dictionary.md).
  estFamiliale: boolean | null;
  // Représentant légal (chantier bail — corrections juridiques, commit C)
  // — mentionné dans l'en-tête LE BAILLEUR du bail généré pour une SCI,
  // avec un repli "[À COMPLÉTER]" tant que non renseigné (jamais de
  // blocage de génération).
  nomGerant: string | null;
  prenomGerant: string | null;
  statut: "active" | "archive";
}

export interface CreateSciInput {
  nom: string;
  regimeFiscal: RegimeFiscal;
  formeJuridique?: string;
  siret?: string;
  // Siège social, connu dès la création d'une SCI (docs/data-dictionary.md)
  // — contrairement à telephone/estFamiliale, restés facultatifs.
  adresse: string;
  codePostal: string;
  ville: string;
  telephone?: string;
  estFamiliale?: boolean;
  nomGerant?: string;
  prenomGerant?: string;
}

// `| null` sur telephone/estFamiliale (point 6d, docs/backlog.md) : un
// champ vidé dans EditSciForm doit être envoyé comme `null` explicite pour
// effacer réellement la valeur en base (voir valeurOuNull,
// lib/valeur-ou-null.ts) — omettre la clé laisserait l'ancienne valeur
// inchangée. nom/regimeFiscal restent non vidables.
export interface UpdateSciInput {
  nom?: string;
  regimeFiscal?: RegimeFiscal;
  formeJuridique?: string;
  siret?: string;
  adresse?: string;
  codePostal?: string;
  ville?: string;
  telephone?: string | null;
  estFamiliale?: boolean | null;
  nomGerant?: string | null;
  prenomGerant?: string | null;
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
