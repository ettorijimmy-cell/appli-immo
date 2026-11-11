import type { FinEngagementColocation, ModeRemiseBail } from "core";
import { authenticatedFetch, authenticatedFetchBlob } from "../lib/authenticated-fetch";

export type LocataireStatut = "actif" | "ancien" | "archive";
export type LocataireStatutModifiable = "actif" | "ancien";
// Statut d'études (chantier garants, 2026-11-08) : sert aux règles de la
// caution personne physique (loi n° 89-462, art. 22-1). « non_renseigne »
// compte comme « aucun ».
export type LocataireStatutEtudes =
  | "non_renseigne"
  | "aucun"
  | "etudiant_boursier"
  | "etudiant_non_boursier"
  | "apprenti";

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
  // Imprimé dans l'acte de cautionnement (chantier garants, commit 6).
  lieuNaissance: string | null;
  statut: LocataireStatut;
  statutEtudes: LocataireStatutEtudes;
}

export interface CreateLocataireInput {
  nom: string;
  prenom: string;
  email?: string;
  telephone?: string;
  adresse?: string;
  codePostal?: string;
  ville?: string;
  dateNaissance?: string;
  lieuNaissance?: string;
  statutEtudes?: LocataireStatutEtudes;
}

// `| null` sur les champs optionnels : un champ vidé dans le formulaire de
// modification doit être envoyé comme `null` explicite pour effacer
// réellement la valeur en base (voir EditLocataireForm, valeurOuNull) —
// omettre la clé laisserait l'ancienne valeur inchangée. Même convention
// que UpdateGarantInput (commit f3513de). nom/prenom restent non vidables.
export interface UpdateLocataireInput {
  nom?: string;
  prenom?: string;
  email?: string | null;
  telephone?: string | null;
  adresse?: string | null;
  codePostal?: string | null;
  ville?: string | null;
  dateNaissance?: string | null;
  lieuNaissance?: string | null;
  statut?: LocataireStatutModifiable;
  statutEtudes?: LocataireStatutEtudes;
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
  // Trimestre IRL de référence de la clause d'indexation (1-4), propre à
  // chaque contrat — jamais déduit automatiquement (Module Tâches, Étape 5,
  // docs/data-dictionary.md, section baux).
  trimestreReferenceRevision: number | null;
  // Assurance loyers impayés souscrite par le bailleur (chantier garants,
  // 2026-11-08) : interdit une caution personne physique en plus, sauf
  // locataire garanti étudiant ou apprenti (loi n° 89-462, art. 22-1).
  assuranceLoyersImpayes: boolean;
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
  assuranceLoyersImpayes?: boolean;
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
  trimestreReferenceRevision?: number;
  assuranceLoyersImpayes?: boolean;
}

// « autre » : ancien type, refusé à la saisie depuis le chantier garants
// (2026-11-08) ; les lignes existantes restent lisibles.
export type GarantTypeGarantie = "personne_physique" | "garantie_visale" | "autre";
export type GarantTypeSaisissable = Exclude<GarantTypeGarantie, "autre">;

export interface Garant {
  id: string;
  bailId: string;
  // Garantie Visale : nom imposé par le backend (« Action Logement
  // Services (Visale) »), prénom null.
  nom: string;
  prenom: string | null;
  email: string | null;
  telephone: string | null;
  typeGarantie: GarantTypeGarantie;
  adresse: string | null;
  codePostal: string | null;
  ville: string | null;
  dateNaissance: string | null;
  lieuNaissance: string | null;
  nationalite: string | null;
  // Locataire du bail dont ce garant se porte caution (null = non précisé).
  locataireId: string | null;
  // Garantie Visale uniquement (null pour une caution).
  numeroContratVisale: string | null;
  archivedAt: string | null;
}

// Garantie Visale : nom et prénom omis (imposés par le backend).
export interface CreateGarantInput {
  bailId: string;
  nom?: string;
  prenom?: string;
  email?: string;
  telephone?: string;
  typeGarantie: GarantTypeSaisissable;
  numeroContratVisale?: string;
  adresse?: string;
  codePostal?: string;
  ville?: string;
  dateNaissance?: string;
  lieuNaissance?: string;
  nationalite?: string;
  locataireId?: string;
}

// `| null` sur les champs optionnels : contrairement à CreateGarantInput, un
// champ vidé dans le formulaire de modification doit être envoyé comme
// `null` explicite pour effacer réellement la valeur en base (voir
// EditGarantForm) — omettre la clé, comme le fait UpdateLocataireInput,
// laisserait l'ancienne valeur inchangée.
export interface UpdateGarantInput {
  nom?: string;
  prenom?: string;
  email?: string | null;
  telephone?: string | null;
  // Omis pour une ligne « autre » dont on ne change pas le type (le
  // backend refuse « autre » en écriture).
  typeGarantie?: GarantTypeSaisissable;
  numeroContratVisale?: string | null;
  adresse?: string | null;
  codePostal?: string | null;
  ville?: string | null;
  dateNaissance?: string | null;
  lieuNaissance?: string | null;
  nationalite?: string | null;
  // null efface le lien « Caution de » (non précisé).
  locataireId?: string | null;
}

export type BailLocataireRole = "titulaire" | "colocataire";

export interface BailLocataire {
  id: string;
  bailId: string;
  locataireId: string;
  role: BailLocataireRole;
  // Date d'effet du congé donné par ce locataire (chantier garants, commit
  // 6) : fin d'engagement de sa caution en colocation (art. 8-1, VI).
  dateEffetConge: string | null;
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

// Libellés des champs de performance énergétique (mentions du contrat-type,
// décret n° 2015-587) pouvant revenir dans l'en-tête X-Champs-Energie-
// Manquants — clés alignées sur CHAMP_ENERGIE_MANQUANT côté backend
// (bail-document-docx.service.ts).
const LIBELLES_CHAMPS_ENERGIE: Record<string, string> = {
  classeDpe: "classe DPE",
  depensesEnergie: "dépenses énergétiques",
  anneeReferencePrixEnergie: "année de référence des prix énergétiques"
};

// Récupère le .docx généré côté backend et l'ouvre directement avec
// l'application par défaut du système (même méthode que
// genererDocumentEtatDesLieux, etats-des-lieux/api.ts) — plus de
// téléchargement navigateur (<a download>), voir main/documents-temp.ts et
// le canal IPC documents:ouvrirTemporaire. Le backend bloque déjà avec un
// message explicite (champsManquants) si des données obligatoires
// manquent ; l'appelant se contente de relayer ce message (ApiError).
//
// Mentions de performance énergétique (décret n° 2015-587) : jamais
// bloquantes (décision Jimmy, 2026-10-04) — le backend génère quand même
// le document avec des mentions "[À COMPLÉTER]" et signale les champs
// concernés via l'en-tête X-Champs-Energie-Manquants (voir exposedHeaders,
// main.ts). Avertissement APRÈS la génération, pas avant : le document est
// déjà intégralement produit côté backend et déjà téléchargé en entier
// (await blob.arrayBuffer() ci-dessous) au moment où cet en-tête est lu —
// la confirmation ne gage que l'ouverture locale du fichier, jamais le
// travail de génération lui-même ni le transfert réseau, qui ont déjà eu
// lieu. Une vérification réellement préalable à la génération demanderait
// un endpoint de contrôle séparé (dupliquant le calcul déjà fait côté
// service pour construire le document) — non construit ici.
export async function genererDocumentBail(id: string): Promise<void> {
  const { blob, nomFichier, headers } = await authenticatedFetchBlob(`/baux/${id}/document-docx`, {
    method: "POST"
  });
  const champsManquants = headers.get("X-Champs-Energie-Manquants");
  if (champsManquants) {
    const libelles = champsManquants
      .split(",")
      .map((cle) => LIBELLES_CHAMPS_ENERGIE[cle] ?? cle)
      .join(", ");
    const continuer = window.confirm(
      `Mentions de performance énergétique incomplètes sur cet appartement : ${libelles}.\n` +
        `Le document sera généré avec des mentions "[À COMPLÉTER]" à la place. Continuer ?`
    );
    if (!continuer) {
      return;
    }
  }
  await window.api.documents.ouvrirTemporaire(await blob.arrayBuffer(), nomFichier ?? "bail.docx");
}

// Règles d'acceptation des garanties (packages/core, verifierGarantiesBail)
// et pièces manquantes (contrat Visale), dans le même contexte que la
// génération du bail : GET /baux/:id/verification-garanties.
export interface ViolationGarantieBail {
  code: string;
  garantId: string | null;
  message: string;
}

export interface PieceManquanteGarant {
  code: "contrat_visale_manquant";
  garantId: string;
  categorie: "contrat_cautionnement_visale";
  message: string;
}

export interface VerificationGarantiesBail {
  violations: ViolationGarantieBail[];
  piecesManquantes: PieceManquanteGarant[];
}

export function getVerificationGaranties(bailId: string): Promise<VerificationGarantiesBail> {
  return authenticatedFetch<VerificationGarantiesBail>(`/baux/${bailId}/verification-garanties`);
}

// Acte de cautionnement d'une caution personne physique (chantier garants,
// commit 5) : même parcours que genererDocumentBail — .docx produit par le
// backend, ouvert dans Word, jamais archivé. Un dossier incomplet remonte
// en ApiError avec champsManquants.
export async function genererActeCautionnement(garantId: string): Promise<void> {
  const { blob, nomFichier } = await authenticatedFetchBlob(`/garants/${garantId}/acte-cautionnement-docx`, {
    method: "POST"
  });
  await window.api.documents.ouvrirTemporaire(await blob.arrayBuffer(), nomFichier ?? "acte-cautionnement.docx");
}

// Suivi d'une caution personne physique (chantier garants, commit 6) :
// remise d'un exemplaire du bail (loi n° 89-462, art. 22-1) et fin
// d'engagement. Hors PowerSync, lus en REST (garant_remise_bail).
export interface DeclarationRemiseBail {
  id: string;
  dateRemise: string;
  mode: ModeRemiseBail;
  declareeLe: string;
  declareePar: string;
  archivedAt: string | null;
}

export interface RemiseBailCaution {
  active: DeclarationRemiseBail | null;
  // Déclarations remplacées par une correction, la plus récente en premier.
  historique: DeclarationRemiseBail[];
}

export interface EngagementCaution {
  dateFinEngagement: string | null;
  motifIndisponible: string | null;
  colocation: (FinEngagementColocation & { dateEffetConge: string }) | null;
}

export function getRemiseBail(garantId: string): Promise<RemiseBailCaution> {
  return authenticatedFetch<RemiseBailCaution>(`/garants/${garantId}/remise-bail`);
}

// Déclaration, ou correction quand une déclaration est déjà active (le
// backend archive l'ancienne et en crée une nouvelle).
export function declarerRemiseBail(
  garantId: string,
  input: { dateRemise: string; mode: ModeRemiseBail }
): Promise<RemiseBailCaution> {
  return authenticatedFetch<RemiseBailCaution>(`/garants/${garantId}/remise-bail`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getEngagementCaution(garantId: string): Promise<EngagementCaution> {
  return authenticatedFetch<EngagementCaution>(`/garants/${garantId}/engagement`);
}

export interface SuiviCaution {
  remise: RemiseBailCaution;
  engagement: EngagementCaution;
}

// Suivi de chaque caution personne physique non archivée d'un bail. Un
// échec de lecture n'empêche pas le reste de la fiche : la caution
// concernée est simplement absente de la table.
export async function chargerSuivisCautions(garants: readonly Garant[]): Promise<Map<string, SuiviCaution>> {
  const cautions = garants.filter((g) => g.typeGarantie === "personne_physique" && g.archivedAt === null);
  const suivis = await Promise.all(
    cautions.map(async (garant) => {
      try {
        const [remise, engagement] = await Promise.all([getRemiseBail(garant.id), getEngagementCaution(garant.id)]);
        return [[garant.id, { remise, engagement }] as const];
      } catch {
        return [];
      }
    })
  );
  return new Map(suivis.flat());
}

export function listGarants(bailId: string): Promise<Garant[]> {
  return authenticatedFetch<Garant[]>(`/garants?bailId=${encodeURIComponent(bailId)}`);
}

export function getGarant(id: string): Promise<Garant> {
  return authenticatedFetch<Garant>(`/garants/${id}`);
}

export function createGarant(input: CreateGarantInput): Promise<Garant> {
  return authenticatedFetch<Garant>("/garants", { method: "POST", body: JSON.stringify(input) });
}

export function updateGarant(id: string, input: UpdateGarantInput): Promise<Garant> {
  return authenticatedFetch<Garant>(`/garants/${id}`, { method: "PATCH", body: JSON.stringify(input) });
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

// Date d'effet du congé : null l'efface.
export function updateDateEffetConge(lienId: string, dateEffetConge: string | null): Promise<BailLocataire> {
  return authenticatedFetch<BailLocataire>(`/bail-locataires/${lienId}`, {
    method: "PATCH",
    body: JSON.stringify({ dateEffetConge })
  });
}

// Retrait du locataire ; la date d'effet de son congé, si elle est saisie,
// est enregistrée dans la même requête.
export function archiveBailLocataire(id: string, dateEffetConge?: string): Promise<BailLocataire> {
  return authenticatedFetch<BailLocataire>(`/bail-locataires/${id}/archiver`, {
    method: "PATCH",
    body: JSON.stringify(dateEffetConge ? { dateEffetConge } : {})
  });
}
