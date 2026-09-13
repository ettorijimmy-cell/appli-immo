import { authenticatedFetch } from "../lib/authenticated-fetch";

export type CandidatStatut = "en_attente" | "valide" | "refuse" | "converti";

export const CANDIDAT_STATUTS: CandidatStatut[] = ["en_attente", "valide", "refuse", "converti"];

export const CANDIDAT_STATUT_LABELS: Record<CandidatStatut, string> = {
  en_attente: "En attente",
  valide: "Validé",
  refuse: "Refusé",
  converti: "Converti"
};

export interface Candidat {
  id: string;
  nom: string;
  telephone: string | null;
  email: string | null;
  appartementId: string | null;
  notes: string | null;
  statut: CandidatStatut;
  revenuMensuelNet: string | null;
  loyerVise: string | null;
  situationProfessionnelle: string | null;
  garantNom: string | null;
  garantRevenuMensuelNet: string | null;
  archivedAt: string | null;
}

export interface CreateCandidatInput {
  nom: string;
  telephone?: string;
  email?: string;
  appartementId?: string;
  notes?: string;
  statut?: CandidatStatut;
  revenuMensuelNet?: string;
  loyerVise?: string;
  situationProfessionnelle?: string;
  garantNom?: string;
  garantRevenuMensuelNet?: string;
}

export type UpdateCandidatInput = Partial<CreateCandidatInput>;

export function listCandidats(): Promise<Candidat[]> {
  return authenticatedFetch<Candidat[]>("/candidats");
}

export function getCandidat(id: string): Promise<Candidat> {
  return authenticatedFetch<Candidat>(`/candidats/${id}`);
}

export function createCandidat(input: CreateCandidatInput): Promise<Candidat> {
  return authenticatedFetch<Candidat>("/candidats", { method: "POST", body: JSON.stringify(input) });
}

export function updateCandidat(id: string, input: UpdateCandidatInput): Promise<Candidat> {
  return authenticatedFetch<Candidat>(`/candidats/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function archiveCandidat(id: string): Promise<Candidat> {
  return authenticatedFetch<Candidat>(`/candidats/${id}/archiver`, { method: "PATCH" });
}
