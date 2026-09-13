import { authenticatedFetch } from "../lib/authenticated-fetch";

export interface EnTete {
  biensLoues: number;
  biensVacants: number;
  biensTravaux: number;
  valeurLocativeTotale: string;
}

export interface Cartes {
  impayes: { nombre: number; montantRestant: string };
  echeancesAVenir: number;
  documentsExpires: number;
  alertesActives: number;
}

export interface RevenuMensuel {
  mois: string;
  loyerNet: string;
  provisions: string;
}

export interface RevenusLocatifs {
  periodeDebut: string;
  periodeFin: string;
  parMois: RevenuMensuel[];
  totalLoyerNet: string;
  totalProvisions: string;
}

export interface SyntheseAppartement {
  id: string;
  numero: string;
  revenuNet: string;
  tauxOccupation: number;
  archive: boolean;
}

export interface SyntheseBien {
  id: string;
  nom: string;
  revenuNet: string;
  tauxOccupation: number;
  archive: boolean;
  appartements: SyntheseAppartement[];
}

export interface SyntheseSci {
  id: string;
  nom: string;
  revenuNet: string;
  tauxOccupation: number;
  archive: boolean;
  biens: SyntheseBien[];
}

export function getEnTete(): Promise<EnTete> {
  return authenticatedFetch<EnTete>("/tableau-de-bord/en-tete");
}

export function getCartes(): Promise<Cartes> {
  return authenticatedFetch<Cartes>("/tableau-de-bord/cartes");
}

// Module Charges et fiscalité, Étape 3 (docs/backlog.md) : filtres bien/sci
// optionnels pour le cockpit "Comptabilité" — TableauDeBordPage continue
// d'appeler cette fonction sans 3ᵉ argument, comportement inchangé.
export function getRevenusLocatifs(
  debut: string,
  fin: string,
  filtres: { bienId?: string; sciId?: string } = {}
): Promise<RevenusLocatifs> {
  const params = new URLSearchParams({ debut, fin });
  if (filtres.bienId) params.set("bienId", filtres.bienId);
  if (filtres.sciId) params.set("sciId", filtres.sciId);
  return authenticatedFetch<RevenusLocatifs>(`/tableau-de-bord/revenus-locatifs?${params.toString()}`);
}

export function getSynthese(debut: string, fin: string): Promise<SyntheseSci[]> {
  return authenticatedFetch<SyntheseSci[]>(`/tableau-de-bord/synthese?debut=${debut}&fin=${fin}`);
}

export function getDerniereSauvegarde(): Promise<{ dateIso: string | null }> {
  return authenticatedFetch<{ dateIso: string | null }>("/tableau-de-bord/derniere-sauvegarde");
}

export interface RemboursementEnAttente {
  bailId: string;
  paiementId: string;
  montant: string;
}

// Calculé à la volée côté backend, jamais stocké (docs/data-dictionary.md,
// section "versements & remboursements") : reste visible tant qu'aucun
// remboursement ne couvre le trop-perçu détecté, y compris après un
// archivage ultérieur du bien.
export function getRemboursementsEnAttente(): Promise<RemboursementEnAttente[]> {
  return authenticatedFetch<RemboursementEnAttente[]>("/tableau-de-bord/remboursements-en-attente");
}

export interface ChecklistAppartement {
  appartementId: string;
  bienId: string | null;
  categoriesManquantes: string[];
}

export interface ChecklistLocataire {
  locataireId: string;
  bailId: string;
}

export interface ChecklistGarant {
  garantId: string;
  bailId: string;
}

export interface ChecklistDocumentaire {
  appartements: ChecklistAppartement[];
  locataires: ChecklistLocataire[];
  garants: ChecklistGarant[];
}

// Calculée à la volée côté backend, jamais stockée (même philosophie que
// getRemboursementsEnAttente ci-dessus) — ne renvoie que les entités avec
// au moins un document manquant.
export function getChecklistDocumentaire(): Promise<ChecklistDocumentaire> {
  return authenticatedFetch<ChecklistDocumentaire>("/tableau-de-bord/checklist-documentaire");
}

export interface CompletudeCategorie {
  categorie: string;
  document: { id: string; nomFichier: string } | null;
}

// Vue détaillée pour une seule entité (statut complet, y compris les
// catégories déjà satisfaites) — même détection que getChecklistDocumentaire
// ci-dessus (evaluerCompletudeCategories, packages/core), jamais dupliquée.
// entiteType='candidat' exige `role` ('candidat' ou 'garant') — deux jeux de
// documents distincts pour la même entité (extension checklist candidat,
// 2026-09-15).
export function getCompletudeDocumentaire(
  entiteType: "appartement" | "locataire" | "garant" | "candidat",
  entiteId: string,
  role?: "candidat" | "garant"
): Promise<CompletudeCategorie[]> {
  const roleParam = role ? `&role=${role}` : "";
  return authenticatedFetch<CompletudeCategorie[]>(
    `/tableau-de-bord/completude-documents?entiteType=${entiteType}&entiteId=${encodeURIComponent(entiteId)}${roleParam}`
  );
}
