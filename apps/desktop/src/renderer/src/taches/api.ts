import { authenticatedFetch } from "../lib/authenticated-fetch";

export type TacheType =
  | "impaye"
  | "entretien_equipement"
  | "document_expire"
  | "quittance_mensuelle"
  | "revision_loyer"
  | "autre";
export type TacheStatut = "a_faire" | "en_cours" | "fait" | "annulee";
export type TacheOrigine = "alerte" | "planifiee" | "manuelle";

export interface Tache {
  id: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  version: number;
  archivedAt: string | null;
  type: TacheType;
  statut: TacheStatut;
  origine: TacheOrigine;
  alerteSourceId: string | null;
  bailId: string | null;
  appartementId: string | null;
  bienId: string | null;
  locataireId: string | null;
  dateEcheance: string | null;
  dateCompletion: string | null;
  periodeRecurrence: string | null;
  notes: string | null;
  metadata: unknown;
  organisationId: string;
}

export function listTaches(filtres: { statut?: TacheStatut; type?: TacheType } = {}): Promise<Tache[]> {
  const params = new URLSearchParams();
  if (filtres.statut) params.set("statut", filtres.statut);
  if (filtres.type) params.set("type", filtres.type);
  const query = params.toString();
  return authenticatedFetch<Tache[]>(`/taches${query ? `?${query}` : ""}`);
}

// Déclenchement manuel du job quotidien (même code que le @Cron réel,
// apps/backend/src/taches/taches-job.service.ts) — même principe que
// executerJobAlertes (alertes/api.ts).
export function executerJobTaches(): Promise<Tache[]> {
  return authenticatedFetch<Tache[]>("/taches/executer-job", { method: "POST" });
}

export function marquerTacheFait(id: string): Promise<Tache> {
  return authenticatedFetch<Tache>(`/taches/${id}/marquer-fait`, { method: "PATCH" });
}

export function marquerTacheAnnulee(id: string): Promise<Tache> {
  return authenticatedFetch<Tache>(`/taches/${id}/marquer-annulee`, { method: "PATCH" });
}

// Action dédiée pour une tâche type='revision_loyer' — jamais marquerFait,
// le montant proposé par le job doit pouvoir être ajusté avant application
// (apps/backend/src/taches/taches.service.ts, appliquerRevision).
export function appliquerRevisionTache(id: string, nouveauLoyerValide: string): Promise<Tache> {
  return authenticatedFetch<Tache>(`/taches/${id}/appliquer-revision`, {
    method: "PATCH",
    body: JSON.stringify({ nouveauLoyerValide })
  });
}

// Forme de tache.metadata pour type='revision_loyer', posée par
// TachesJobService.genererTachesRevisionLoyer — non garantie par le type
// (metadata est jsonb, unknown), vérifiée au runtime par
// lireMetadataRevisionLoyer avant tout affichage.
export interface MetadataRevisionLoyer {
  loyerActuel: string;
  loyerPropose: string;
}

export function lireMetadataRevisionLoyer(metadata: unknown): MetadataRevisionLoyer | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const m = metadata as Record<string, unknown>;
  if (typeof m.loyerActuel !== "string" || typeof m.loyerPropose !== "string") return null;
  return { loyerActuel: m.loyerActuel, loyerPropose: m.loyerPropose };
}
