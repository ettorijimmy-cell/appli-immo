import { authenticatedFetch } from "../lib/authenticated-fetch";

export type EtatElement = "M" | "P" | "B" | "TB";
export type EtatInventaire = "bon" | "dusage" | "mauvais";
export type StatutEtatDesLieux = "non_commence" | "entree_terminee" | "complet";
export type TypeCle = "immeuble" | "porte_entree" | "boite_lettres" | "cave" | "badge_portail" | "parking" | "autre";
export type CategorieInventaire = "meuble" | "electromenager" | "vaisselle_linge";

export interface EtatDesLieux {
  id: string;
  bailId: string;
  dateEntree: string | null;
  dateSortie: string | null;
  nouvelleAdresseLocataire: string | null;
  statut: StatutEtatDesLieux;
  archivedAt: string | null;
}

// Ligne de pièce brute renvoyée par l'API (colonnes plates : prefix +
// Description/EtatEntree/EtatSortie) — même contrat que apps/desktop.
export type PieceRow = {
  id: string;
  etatDesLieuxId: string;
  numero?: number;
  libelle?: string | null;
  prisesNombre?: number | null;
  electromenagerDescription?: string | null;
} & Record<string, string | number | null | undefined>;

export interface Compteurs {
  id: string;
  etatDesLieuxId: string;
  electriciteNumeroCompteurEntree: string | null;
  electriciteNumeroCompteurSortie: string | null;
  electriciteReleveHpEntree: string | null;
  electriciteReleveHpSortie: string | null;
  electriciteReleveHcEntree: string | null;
  electriciteReleveHcSortie: string | null;
  electriciteAncienOccupantEntree: string | null;
  electriciteAncienOccupantSortie: string | null;
  gazNumeroCompteurEntree: string | null;
  gazNumeroCompteurSortie: string | null;
  gazReleveEntree: string | null;
  gazReleveSortie: string | null;
  eauReleveFroideEntree: string | null;
  eauReleveFroideSortie: string | null;
  eauReleveChaudeEntree: string | null;
  eauReleveChaudeSortie: string | null;
}

export interface LigneCle {
  id: string;
  etatDesLieuxId: string;
  typeCle: TypeCle;
  libelleAutre: string | null;
  nombreEntree: number | null;
  nombreSortie: number | null;
  commentaire: string | null;
  archivedAt: string | null;
}

export interface LigneEquipementDivers {
  id: string;
  etatDesLieuxId: string;
  libelle: string;
  nombreEntree: number | null;
  etatEntree: EtatInventaire | null;
  nombreSortie: number | null;
  etatSortie: EtatInventaire | null;
  commentaire: string | null;
  archivedAt: string | null;
}

export interface ElementInventaireMeuble {
  id: string;
  code: string;
  libelle: string;
  categorie: CategorieInventaire;
  ordreAffichage: number;
}

export interface LigneInventaire {
  id: string;
  elementId: string;
  nombreEntree: number | null;
  etatEntree: EtatInventaire | null;
  nombreSortie: number | null;
  etatSortie: EtatInventaire | null;
  commentaire: string | null;
  archivedAt: string | null;
  elementCode: string;
  elementLibelle: string;
  elementCategorie: CategorieInventaire;
  elementOrdreAffichage: number;
}

export interface EtatDesLieuxComplet extends EtatDesLieux {
  entree: PieceRow | null;
  sejour: PieceRow | null;
  cuisine: PieceRow | null;
  chambres: PieceRow[];
  sallesDeBain: PieceRow[];
  wc: PieceRow[];
  autres: PieceRow[];
  compteurs: Compteurs | null;
  cles: LigneCle[];
  equipementsDivers: LigneEquipementDivers[];
  inventaire: LigneInventaire[];
}

export function getEtatDesLieuxParBail(bailId: string): Promise<EtatDesLieuxComplet | null> {
  return authenticatedFetch<EtatDesLieuxComplet | null>(`/etats-des-lieux?bailId=${bailId}`);
}

export function createEtatDesLieux(bailId: string): Promise<EtatDesLieux> {
  return authenticatedFetch<EtatDesLieux>("/etats-des-lieux", { method: "POST", body: JSON.stringify({ bailId }) });
}

export function updateEtatDesLieuxHeader(
  id: string,
  input: { dateEntree?: string; dateSortie?: string; nouvelleAdresseLocataire?: string }
): Promise<EtatDesLieux> {
  return authenticatedFetch<EtatDesLieux>(`/etats-des-lieux/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

function submitPiece(id: string, segment: string, payload: Record<string, unknown>): Promise<PieceRow> {
  return authenticatedFetch<PieceRow>(`/etats-des-lieux/${id}/${segment}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export const submitPieceEntree = (id: string, payload: Record<string, unknown>): Promise<PieceRow> =>
  submitPiece(id, "piece-entree", payload);
export const submitPieceSejour = (id: string, payload: Record<string, unknown>): Promise<PieceRow> =>
  submitPiece(id, "piece-sejour", payload);
export const submitPieceCuisine = (id: string, payload: Record<string, unknown>): Promise<PieceRow> =>
  submitPiece(id, "piece-cuisine", payload);
export const submitPieceChambre = (id: string, payload: Record<string, unknown>): Promise<PieceRow> =>
  submitPiece(id, "piece-chambre", payload);
export const submitPieceSalleDeBain = (id: string, payload: Record<string, unknown>): Promise<PieceRow> =>
  submitPiece(id, "piece-salle-de-bain", payload);
export const submitPieceWc = (id: string, payload: Record<string, unknown>): Promise<PieceRow> =>
  submitPiece(id, "piece-wc", payload);
export const submitPieceAutre = (id: string, payload: Record<string, unknown>): Promise<PieceRow> =>
  submitPiece(id, "piece-autre", payload);

export function submitCompteurs(id: string, payload: Record<string, unknown>): Promise<Compteurs> {
  return authenticatedFetch<Compteurs>(`/etats-des-lieux/${id}/compteurs`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export interface LigneCleInput {
  id?: string;
  typeCle: TypeCle;
  libelleAutre?: string;
  nombreEntree?: number;
  nombreSortie?: number;
  commentaire?: string;
}

export interface LigneEquipementDiversInput {
  id?: string;
  libelle: string;
  nombreEntree?: number;
  etatEntree?: EtatInventaire;
  nombreSortie?: number;
  etatSortie?: EtatInventaire;
  commentaire?: string;
}

export interface LigneInventaireInput {
  elementId: string;
  nombreEntree?: number;
  etatEntree?: EtatInventaire;
  nombreSortie?: number;
  etatSortie?: EtatInventaire;
  commentaire?: string;
}

export function submitCles(
  id: string,
  lignes: LigneCleInput[],
  idsASupprimer: string[] = []
): Promise<LigneCle[]> {
  return authenticatedFetch<LigneCle[]>(`/etats-des-lieux/${id}/cles`, {
    method: "PATCH",
    body: JSON.stringify({ lignes, idsASupprimer })
  });
}

export function submitEquipementsDivers(
  id: string,
  lignes: LigneEquipementDiversInput[],
  idsASupprimer: string[] = []
): Promise<LigneEquipementDivers[]> {
  return authenticatedFetch<LigneEquipementDivers[]>(`/etats-des-lieux/${id}/equipements-divers`, {
    method: "PATCH",
    body: JSON.stringify({ lignes, idsASupprimer })
  });
}

export function submitInventaire(
  id: string,
  lignes: LigneInventaireInput[],
  elementsASupprimer: string[] = []
): Promise<LigneInventaire[]> {
  return authenticatedFetch<LigneInventaire[]>(`/etats-des-lieux/${id}/inventaire`, {
    method: "PATCH",
    body: JSON.stringify({ lignes, elementsASupprimer })
  });
}

export function getCatalogueInventaire(): Promise<ElementInventaireMeuble[]> {
  return authenticatedFetch<ElementInventaireMeuble[]>("/etats-des-lieux/catalogue-inventaire");
}
