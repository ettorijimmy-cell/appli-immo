import { authenticatedFetch, authenticatedFetchBlob } from "../lib/authenticated-fetch";

export type EtatElement = "M" | "P" | "B" | "TB";
export type EtatInventaire = "bon" | "dusage" | "mauvais";
export type StatutEtatDesLieux = "non_commence" | "entree_terminee" | "complet";
export type TypeCle = "immeuble" | "porte_entree" | "boite_lettres" | "cave" | "badge_portail" | "parking" | "autre";
export type CategorieInventaire = "meuble" | "electromenager" | "vaisselle_linge";

export type RoleSignataire = "bailleur" | "locataire";

export interface EtatDesLieux {
  id: string;
  bailId: string;
  dateEntree: string | null;
  dateSortie: string | null;
  lieuEntree: string | null;
  lieuSortie: string | null;
  nouvelleAdresseLocataire: string | null;
  observationsBailleurEntree: string | null;
  reservesLocataireEntree: string | null;
  observationsBailleurSortie: string | null;
  reservesLocataireSortie: string | null;
  statut: StatutEtatDesLieux;
  archivedAt: string | null;
  entreeSigneeParTous: boolean;
  sortieSigneeParTous: boolean;
}

export interface SignaturePosee {
  phase: "entree" | "sortie";
  role: RoleSignataire;
  locataireId: string | null;
  nomAffiche: string;
  luEtApprouve: boolean;
  documentId: string;
  signeLe: string;
}

export interface ElementChampInput {
  description?: string;
  etatEntree?: EtatElement;
  etatSortie?: EtatElement;
}

// Ligne de pièce brute renvoyée par l'API (colonnes plates : prefix +
// Description/EtatEntree/EtatSortie) — traitée comme un dictionnaire
// indexé par préfixe pour piloter l'affichage depuis une config
// déclarative (PieceGrid) plutôt que de dupliquer un type par pièce.
export type PieceRow = {
  id: string;
  etatDesLieuxId: string;
  numero?: number;
  libelle?: string | null;
  observationsSortie?: string | null;
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
  commentaireSortie: string | null;
  archivedAt: string | null;
  // Posé par le serveur à l'insertion : une ligne ajoutée après la
  // signature d'entrée reste retirable jusqu'à la signature de sortie,
  // contrairement à une ligne qui existait déjà à l'entrée.
  ajouteeApresSignatureEntree: boolean;
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
  commentaireSortie: string | null;
  archivedAt: string | null;
  ajouteeApresSignatureEntree: boolean;
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
  commentaireSortie: string | null;
  archivedAt: string | null;
  ajouteeApresSignatureEntree: boolean;
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

export function getEtatDesLieuxParBail(
  bailId: string,
  avecArchives = false
): Promise<EtatDesLieuxComplet | null> {
  return authenticatedFetch<EtatDesLieuxComplet | null>(
    `/etats-des-lieux?bailId=${bailId}${avecArchives ? "&avecArchives=true" : ""}`
  );
}

export function getEtatDesLieuxById(id: string): Promise<EtatDesLieuxComplet> {
  return authenticatedFetch<EtatDesLieuxComplet>(`/etats-des-lieux/${id}`);
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
  commentaireSortie?: string | null;
}

export interface LigneEquipementDiversInput {
  id?: string;
  libelle: string;
  nombreEntree?: number;
  etatEntree?: EtatInventaire;
  nombreSortie?: number;
  etatSortie?: EtatInventaire;
  commentaire?: string;
  commentaireSortie?: string | null;
}

export interface LigneInventaireInput {
  elementId: string;
  nombreEntree?: number;
  etatEntree?: EtatInventaire;
  nombreSortie?: number;
  etatSortie?: EtatInventaire;
  commentaire?: string;
  commentaireSortie?: string | null;
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

// Relecture desktop (SignaturesCard) : signatures déjà posées, toutes
// phases confondues — l'image de chacune se récupère séparément via le
// point d'accès générique /documents/:id/contenu (documents/api.ts),
// jamais renvoyée ici.
export function getSignaturesPosees(id: string): Promise<SignaturePosee[]> {
  return authenticatedFetch<SignaturePosee[]>(`/etats-des-lieux/${id}/signatures`);
}

export interface StatutDocumentsFigesPhase {
  phase: "entree" | "sortie";
  docx: { documentId: string; createdAt: string } | null;
  pdf: { documentId: string; createdAt: string } | null;
}

// Chantier PDF étape 4 (DocumentsFigesCard) : présence/absence du .docx et
// du PDF figés, par phase — jamais leur contenu (voir /pdf/:phase/contenu,
// use-etat-des-lieux-pdf-apercu.ts). Déclenche aussi, côté backend, un
// rattrapage en arrière-plan pour toute phase signée incomplète (jamais
// attendu par cette lecture) — revenir lire cette route plus tard suffit à
// voir le résultat, inutile de la redéclencher soi-même.
export function listerDocumentsFigesEtatDesLieux(id: string): Promise<StatutDocumentsFigesPhase[]> {
  return authenticatedFetch<StatutDocumentsFigesPhase[]>(`/etats-des-lieux/${id}/pdf`);
}

// Bouton "Produire le PDF" (DocumentsFigesCard) : idempotent côté backend,
// ne produit que ce qui manque pour cette phase — 409 si la phase n'est
// pas signée (jamais affiché dans ce cas, mais l'appelant relaie quand
// même le message ApiError si la course a changé l'état entre deux
// lectures). Réponse 204 ; l'appelant relit ensuite via
// listerDocumentsFigesEtatDesLieux plutôt que de supposer le résultat.
export function produirePdfEtatDesLieux(id: string, phase: "entree" | "sortie"): Promise<void> {
  return authenticatedFetch<void>(`/etats-des-lieux/${id}/pdf/${phase}`, { method: "POST" });
}

export type PhaseEtatDesLieux = "entree" | "sortie";

export interface ResultatEnvoi {
  locataireId: string;
  nomDestinataire: string;
  adresseUtilisee: string;
  statut: "en_cours" | "envoye" | "echec" | "indetermine";
  tenteLe: string;
  envoyeLe: string | null;
  codeErreur: string | null;
  messageErreur: string | null;
}

export interface EnvoiHistorique extends ResultatEnvoi {
  id: string;
  phase: PhaseEtatDesLieux;
  adresseExpediteur: string | null;
  objet: string;
  smtpMessageId: string | null;
  pdfSha256: string;
}

export interface DestinataireEnvoi {
  locataireId: string;
  nomAffiche: string;
  email: string | null;
  dernierEnvoi: ResultatEnvoi | null;
}

export function getDestinatairesEnvoi(
  id: string,
  phase: PhaseEtatDesLieux
): Promise<{ pdfDisponible: boolean; destinataires: DestinataireEnvoi[] }> {
  return authenticatedFetch(`/etats-des-lieux/${id}/envois/${phase}/destinataires`);
}

export function getHistoriqueEnvois(id: string): Promise<EnvoiHistorique[]> {
  return authenticatedFetch<EnvoiHistorique[]>(`/etats-des-lieux/${id}/envois`);
}

export function envoyerEtatDesLieux(
  id: string,
  phase: PhaseEtatDesLieux,
  demande: { demandeId: string; destinataires: { locataireId: string; email: string }[] }
): Promise<{ resultats: ResultatEnvoi[] }> {
  return authenticatedFetch<{ resultats: ResultatEnvoi[] }>(`/etats-des-lieux/${id}/envois/${phase}`, {
    method: "POST",
    body: JSON.stringify(demande)
  });
}

// Récupère le .docx généré côté backend et l'ouvre directement avec
// l'application par défaut du système, via le canal IPC
// documents:ouvrirTemporaire (main/documents-temp.ts) — plus de
// téléchargement navigateur. Le backend bloque déjà avec un message
// explicite (champsManquants) si l'entrée n'est pas terminée ou si la
// composition de l'appartement est incomplète ; l'appelant se contente de
// relayer ce message (ApiError).
export async function genererDocumentEtatDesLieux(id: string): Promise<void> {
  const { blob, nomFichier } = await authenticatedFetchBlob(`/etats-des-lieux/${id}/document-docx`, {
    method: "POST"
  });
  await window.api.documents.ouvrirTemporaire(await blob.arrayBuffer(), nomFichier ?? "etat-des-lieux.docx");
}
