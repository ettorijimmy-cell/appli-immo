import { authenticatedFetch } from "../lib/authenticated-fetch";

export type DocumentEntiteType =
  | "sci"
  | "immeuble"
  | "bien"
  | "appartement"
  | "locataire"
  | "bail"
  | "etat_des_lieux"
  | "garant"
  | "candidat";
export type DocumentEtatDesLieuxPieceType =
  | "entree"
  | "sejour"
  | "cuisine"
  | "chambre"
  | "salle_de_bain"
  | "wc"
  | "autre";
export type DocumentCategorie =
  | "bail"
  | "assurance"
  | "etat_des_lieux"
  | "diagnostic"
  | "dpe"
  | "elec_gaz"
  | "crep_plomb"
  | "erp"
  | "piece_identite"
  | "rib"
  | "caf"
  | "quittance"
  | "courrier"
  | "photo";
export type DocumentStatut = "valide" | "expire" | "archive";

export interface DocumentMetier {
  id: string;
  entiteType: DocumentEntiteType;
  entiteId: string;
  categorie: DocumentCategorie;
  statut: DocumentStatut;
  dateExpiration: string | null;
  nomFichier: string;
  mimeType: string;
  tailleOctets: number;
  archivedAt: string | null;
  etatDesLieuxPieceType: DocumentEtatDesLieuxPieceType | null;
  etatDesLieuxPieceNumero: number | null;
}

export interface UploadDocumentInput {
  entiteType: DocumentEntiteType;
  entiteId: string;
  categorie: DocumentCategorie;
  dateExpiration?: string;
}

export interface FindAllDocumentsFiltres {
  entiteType?: DocumentEntiteType;
  entiteId?: string;
  categorie?: DocumentCategorie;
  statut?: DocumentStatut;
  recherche?: string;
  avecArchives?: boolean;
}

export async function uploadDocument(fichier: File, meta: UploadDocumentInput): Promise<DocumentMetier> {
  const formData = new FormData();
  formData.append("fichier", fichier);
  formData.append("entiteType", meta.entiteType);
  formData.append("entiteId", meta.entiteId);
  formData.append("categorie", meta.categorie);
  if (meta.dateExpiration) {
    formData.append("dateExpiration", meta.dateExpiration);
  }
  return authenticatedFetch<DocumentMetier>("/documents", { method: "POST", body: formData });
}

export async function listDocuments(filtres: FindAllDocumentsFiltres = {}): Promise<DocumentMetier[]> {
  const params = new URLSearchParams();
  if (filtres.entiteType) params.set("entiteType", filtres.entiteType);
  if (filtres.entiteId) params.set("entiteId", filtres.entiteId);
  if (filtres.categorie) params.set("categorie", filtres.categorie);
  if (filtres.statut) params.set("statut", filtres.statut);
  if (filtres.recherche) params.set("recherche", filtres.recherche);
  if (filtres.avecArchives) params.set("avecArchives", "true");
  const query = params.toString();
  return authenticatedFetch<DocumentMetier[]>(`/documents${query ? `?${query}` : ""}`);
}

export async function updateDocument(
  id: string,
  input: { categorie?: DocumentCategorie; dateExpiration?: string }
): Promise<DocumentMetier> {
  return authenticatedFetch<DocumentMetier>(`/documents/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function archiveDocument(id: string): Promise<DocumentMetier> {
  return authenticatedFetch<DocumentMetier>(`/documents/${id}/archiver`, { method: "PATCH" });
}

// Nouvelle version chaînée à l'ancienne (documentPrecedentId côté backend,
// jamais re-saisi ici) : l'ancienne est archivée automatiquement dans la
// même transaction. entiteType/entiteId ne se re-saisissent pas — hérités
// de la version remplacée.
export async function remplacerDocument(
  documentId: string,
  fichier: File,
  meta: { categorie: DocumentCategorie; dateExpiration?: string }
): Promise<DocumentMetier> {
  const formData = new FormData();
  formData.append("fichier", fichier);
  formData.append("categorie", meta.categorie);
  if (meta.dateExpiration) {
    formData.append("dateExpiration", meta.dateExpiration);
  }
  return authenticatedFetch<DocumentMetier>(`/documents/${documentId}/remplacer`, {
    method: "POST",
    body: formData
  });
}

