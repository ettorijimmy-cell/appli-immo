import { authenticatedFetch } from "../lib/authenticated-fetch";

export type EvenementType =
  | "intervention_artisan"
  | "visite_candidat"
  | "etat_des_lieux"
  | "expertise_sinistre"
  | "autre";

export const EVENEMENT_TYPES: EvenementType[] = [
  "intervention_artisan",
  "visite_candidat",
  "etat_des_lieux",
  "expertise_sinistre",
  "autre"
];

export const EVENEMENT_TYPE_LABELS: Record<EvenementType, string> = {
  intervention_artisan: "Intervention artisan",
  visite_candidat: "Visite candidat",
  etat_des_lieux: "État des lieux",
  expertise_sinistre: "Expertise sinistre",
  autre: "Autre"
};

export interface EvenementCalendrier {
  id: string;
  type: EvenementType;
  titre: string;
  dateDebut: string;
  dateFin: string | null;
  bienId: string | null;
  appartementId: string | null;
  contactId: string | null;
  candidatId: string | null;
  sinistreId: string | null;
  notes: string | null;
  archivedAt: string | null;
}

export interface CreateEvenementInput {
  type: EvenementType;
  titre: string;
  dateDebut: string;
  dateFin?: string;
  bienId?: string;
  appartementId?: string;
  contactId?: string;
  candidatId?: string;
  sinistreId?: string;
  notes?: string;
}

export type UpdateEvenementInput = Partial<CreateEvenementInput>;

export interface FindAllEvenementsFiltres {
  periodeDebut?: string;
  periodeFin?: string;
  type?: EvenementType;
}

export function listEvenements(filtres: FindAllEvenementsFiltres = {}): Promise<EvenementCalendrier[]> {
  const params = new URLSearchParams();
  if (filtres.periodeDebut) {
    params.set("periodeDebut", filtres.periodeDebut);
  }
  if (filtres.periodeFin) {
    params.set("periodeFin", filtres.periodeFin);
  }
  if (filtres.type) {
    params.set("type", filtres.type);
  }
  const suffixe = params.toString();
  return authenticatedFetch<EvenementCalendrier[]>(`/evenements-calendrier${suffixe ? `?${suffixe}` : ""}`);
}

export function getEvenement(id: string): Promise<EvenementCalendrier> {
  return authenticatedFetch<EvenementCalendrier>(`/evenements-calendrier/${id}`);
}

export function createEvenement(input: CreateEvenementInput): Promise<EvenementCalendrier> {
  return authenticatedFetch<EvenementCalendrier>("/evenements-calendrier", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateEvenement(id: string, input: UpdateEvenementInput): Promise<EvenementCalendrier> {
  return authenticatedFetch<EvenementCalendrier>(`/evenements-calendrier/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function archiveEvenement(id: string): Promise<EvenementCalendrier> {
  return authenticatedFetch<EvenementCalendrier>(`/evenements-calendrier/${id}/archiver`, { method: "PATCH" });
}
