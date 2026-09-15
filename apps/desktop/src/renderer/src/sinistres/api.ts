import { authenticatedFetch } from "../lib/authenticated-fetch";

export type SinistreType = "degat_eaux" | "incendie" | "vol" | "bris_de_glace" | "catastrophe_naturelle" | "autre";

export const SINISTRE_TYPES: SinistreType[] = [
  "degat_eaux",
  "incendie",
  "vol",
  "bris_de_glace",
  "catastrophe_naturelle",
  "autre"
];

export const SINISTRE_TYPE_LABELS: Record<SinistreType, string> = {
  degat_eaux: "Dégât des eaux",
  incendie: "Incendie",
  vol: "Vol",
  bris_de_glace: "Bris de glace",
  catastrophe_naturelle: "Catastrophe naturelle",
  autre: "Autre"
};

export type SinistreStatut = "declare" | "expertise_planifiee" | "expertise_realisee" | "indemnise" | "clos";

export const SINISTRE_STATUTS: SinistreStatut[] = [
  "declare",
  "expertise_planifiee",
  "expertise_realisee",
  "indemnise",
  "clos"
];

export const SINISTRE_STATUT_LABELS: Record<SinistreStatut, string> = {
  declare: "Déclaré",
  expertise_planifiee: "Expertise planifiée",
  expertise_realisee: "Expertise réalisée",
  indemnise: "Indemnisé",
  clos: "Clos"
};

export interface Sinistre {
  id: string;
  type: SinistreType;
  statut: SinistreStatut;
  dateChangementStatut: string;
  bienId: string | null;
  appartementId: string | null;
  contactAssureurId: string | null;
  dateDeclaration: string;
  description: string | null;
  montantReclame: string | null;
  montantIndemnise: string | null;
  franchise: string | null;
  notes: string | null;
  archivedAt: string | null;
}

export interface CreateSinistreInput {
  type: SinistreType;
  bienId?: string;
  appartementId?: string;
  contactAssureurId?: string;
  dateDeclaration: string;
  description?: string;
  montantReclame?: string;
  montantIndemnise?: string;
  franchise?: string;
  notes?: string;
}

export type UpdateSinistreInput = Partial<CreateSinistreInput> & { statut?: SinistreStatut };

export function listSinistres(): Promise<Sinistre[]> {
  return authenticatedFetch<Sinistre[]>("/sinistres");
}

export function getSinistre(id: string): Promise<Sinistre> {
  return authenticatedFetch<Sinistre>(`/sinistres/${id}`);
}

export function createSinistre(input: CreateSinistreInput): Promise<Sinistre> {
  return authenticatedFetch<Sinistre>("/sinistres", { method: "POST", body: JSON.stringify(input) });
}

export function updateSinistre(id: string, input: UpdateSinistreInput): Promise<Sinistre> {
  return authenticatedFetch<Sinistre>(`/sinistres/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function archiveSinistre(id: string): Promise<Sinistre> {
  return authenticatedFetch<Sinistre>(`/sinistres/${id}/archiver`, { method: "PATCH" });
}
