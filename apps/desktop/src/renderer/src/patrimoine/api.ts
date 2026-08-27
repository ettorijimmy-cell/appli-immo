import { authenticatedFetch } from "../lib/authenticated-fetch";

export type BienType = "immeuble" | "maison" | "appartement_isole" | "parking" | "bureau" | "local_commercial";
export type BienProprietaireType = "sci" | "personne_physique";
export type BienTypeHabitat = "collectif" | "individuel";
export type BienRegimeJuridique = "mono_propriete" | "copropriete";

export const BIEN_TYPES: BienType[] = [
  "immeuble",
  "maison",
  "appartement_isole",
  "parking",
  "bureau",
  "local_commercial"
];

export const BIEN_TYPE_LABELS: Record<BienType, string> = {
  immeuble: "Immeuble",
  maison: "Maison",
  appartement_isole: "Appartement isolé",
  parking: "Parking",
  bureau: "Bureau",
  local_commercial: "Local commercial"
};

// Migration bien (2026-08-26, docs/backlog.md) : remplace Immeuble comme
// source de vérité pour la création/gestion du patrimoine. Un immeuble a
// N appartements ; tout autre type en a exactement 1 (règle applicative,
// voir NewBienWizard). typeHabitat/regimeJuridique sont dérivés
// automatiquement pour type='maison' côté backend (toujours renseignés,
// jamais éditables pour ce type) ; requis explicitement pour tout autre
// type. syndic/nbLots/chargesCoproAnnuelles ne sont pertinents que pour
// type='immeuble'.
export interface Bien {
  id: string;
  type: BienType;
  proprietaireType: BienProprietaireType;
  sciId: string | null;
  organisationId: string;
  adresse: string;
  codePostal: string;
  ville: string;
  // Requis uniquement pour type='immeuble' — repli d'affichage partout
  // ailleurs : bien.nom ?? bien.adresse.
  nom: string | null;
  anneeConstruction: number | null;
  dateAcquisition: string | null;
  valeurAcquisition: string | null;
  typeHabitat: BienTypeHabitat | null;
  regimeJuridique: BienRegimeJuridique | null;
  statut: "actif" | "archive";
  syndic: string | null;
  nbLots: number | null;
  chargesCoproAnnuelles: string | null;
}

// Repli d'affichage établi dès la migration bien : un libellé n'a de sens
// obligatoire que pour un immeuble (bien.nom peut être absent sinon).
export function libelleBien(bien: Pick<Bien, "nom" | "adresse">): string {
  return bien.nom ?? bien.adresse;
}

export interface CreateBienInput {
  type: BienType;
  proprietaireType: BienProprietaireType;
  sciId?: string;
  adresse: string;
  codePostal: string;
  ville: string;
  nom?: string;
  anneeConstruction?: number;
  // Requis si type !== 'maison' (dérivés automatiquement sinon, voir Bien
  // ci-dessus) — validé côté backend, pas dupliqué ici.
  typeHabitat?: BienTypeHabitat;
  regimeJuridique?: BienRegimeJuridique;
  syndic?: string;
  nbLots?: number;
  chargesCoproAnnuelles?: string;
}

export interface UpdateBienInput {
  adresse?: string;
  codePostal?: string;
  ville?: string;
  nom?: string;
  anneeConstruction?: number;
  typeHabitat?: BienTypeHabitat;
  regimeJuridique?: BienRegimeJuridique;
  syndic?: string;
  nbLots?: number;
  chargesCoproAnnuelles?: string;
}

export type AppartementType = "T1" | "T2" | "T3" | "T4" | "T5" | "T6";
export type AppartementStatut = "vacant" | "loue" | "travaux" | "archive";
export type AppartementModeProduction = "individuel" | "collectif";
export type AppartementTypeEnergie = "electrique" | "gaz" | "les_deux";

// type/nombrePiecesPrincipales/modeChauffage/modeEauChaude/typeEnergie :
// mentions du contrat-type résidentiel (décret n° 2015-587), null pour un
// bien non résidentiel (parking/bureau/local_commercial — packages/core,
// estTypeResidentiel) : sans objet pour ces types, jamais soumis pour eux
// (NewBienWizard, BienDetailView, AppartementDetailView) et rejetés par
// AppartementsService s'ils sont fournis (audit du 2026-08-27).
export interface Appartement {
  id: string;
  bienId: string;
  numero: string;
  type: AppartementType | null;
  surface: string | null;
  loyerReference: string | null;
  equipementCuisine: string | null;
  dependancesAnnexes: string | null;
  nombrePiecesPrincipales: number | null;
  modeChauffage: AppartementModeProduction | null;
  modeEauChaude: AppartementModeProduction | null;
  typeEnergie: AppartementTypeEnergie | null;
  // Composition réelle du logement (module État des lieux) — source de
  // vérité pour le nombre d'étapes du parcours mobile et le plafond
  // d'instances ajoutables ici (voir etats-des-lieux/EtatDesLieuxSection.tsx).
  nombreChambres: number | null;
  nombreSallesDeBain: number | null;
  nombreWc: number | null;
  autrePiece1: string | null;
  autrePiece2: string | null;
  statut: AppartementStatut;
}

export interface CreateAppartementInput {
  bienId: string;
  numero: string;
  // Optionnels au niveau de la forme : obligatoires si le bien parent est
  // résidentiel, rejetés sinon — vérifié côté backend (AppartementsService),
  // pas dupliqué ici.
  type?: AppartementType;
  surface?: string;
  loyerReference?: string;
  nombrePiecesPrincipales?: number;
  modeChauffage?: AppartementModeProduction;
  modeEauChaude?: AppartementModeProduction;
  typeEnergie?: AppartementTypeEnergie;
}

export type AppartementStatutModifiable = "vacant" | "loue" | "travaux";

export interface UpdateAppartementInput {
  numero?: string;
  type?: AppartementType;
  surface?: string;
  loyerReference?: string;
  equipementCuisine?: string;
  dependancesAnnexes?: string;
  nombrePiecesPrincipales?: number;
  modeChauffage?: AppartementModeProduction;
  modeEauChaude?: AppartementModeProduction;
  typeEnergie?: AppartementTypeEnergie;
  nombreChambres?: number;
  nombreSallesDeBain?: number;
  nombreWc?: number;
  autrePiece1?: string;
  autrePiece2?: string;
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

export function listBiens(sciId?: string): Promise<Bien[]> {
  return authenticatedFetch<Bien[]>(sciId ? `/biens?sciId=${encodeURIComponent(sciId)}` : "/biens");
}

export function getBien(id: string): Promise<Bien> {
  return authenticatedFetch<Bien>(`/biens/${id}`);
}

export function createBien(input: CreateBienInput): Promise<Bien> {
  return authenticatedFetch<Bien>("/biens", { method: "POST", body: JSON.stringify(input) });
}

export function updateBien(id: string, input: UpdateBienInput): Promise<Bien> {
  return authenticatedFetch<Bien>(`/biens/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function archiveBien(id: string): Promise<Bien> {
  return authenticatedFetch<Bien>(`/biens/${id}/archiver`, { method: "PATCH" });
}

export function listAppartements(bienId?: string): Promise<Appartement[]> {
  return authenticatedFetch<Appartement[]>(
    bienId ? `/appartements?bienId=${encodeURIComponent(bienId)}` : "/appartements"
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
