import { authenticatedFetch } from "../lib/authenticated-fetch";

export type BailTypeBail = "vide" | "meuble";
export type BailStatut = "brouillon" | "actif" | "preavis" | "resilie" | "archive";

export interface Bail {
  id: string;
  appartementId: string;
  typeBail: BailTypeBail;
  statut: BailStatut;
  dateDebut: string;
  dateFin: string | null;
  archivedAt: string | null;
}

export interface Appartement {
  id: string;
  immeubleId: string;
  numero: string;
  nombreChambres: number | null;
  nombreSallesDeBain: number | null;
  nombreWc: number | null;
  autrePiece1: string | null;
  autrePiece2: string | null;
}

export interface Immeuble {
  id: string;
  sciId: string;
  nom: string;
}

export interface Sci {
  id: string;
  nom: string;
}

export interface Locataire {
  id: string;
  nom: string;
  prenom: string;
}

export interface BailLocataire {
  id: string;
  bailId: string;
  locataireId: string;
  archivedAt: string | null;
}

export function listBaux(): Promise<Bail[]> {
  return authenticatedFetch<Bail[]>("/baux");
}

export function getBail(id: string): Promise<Bail> {
  return authenticatedFetch<Bail>(`/baux/${id}`);
}

export function getAppartement(id: string): Promise<Appartement> {
  return authenticatedFetch<Appartement>(`/appartements/${id}`);
}

export function getImmeuble(id: string): Promise<Immeuble> {
  return authenticatedFetch<Immeuble>(`/immeubles/${id}`);
}

export function getSci(id: string): Promise<Sci> {
  return authenticatedFetch<Sci>(`/scis/${id}`);
}

export function listBailLocataires(bailId: string): Promise<BailLocataire[]> {
  return authenticatedFetch<BailLocataire[]>(`/bail-locataires?bailId=${bailId}`);
}

export function getLocataire(id: string): Promise<Locataire> {
  return authenticatedFetch<Locataire>(`/locataires/${id}`);
}

export interface ContexteBail {
  sciNom: string;
  immeubleNom: string;
  appartementNumero: string;
  locatairesNoms: string;
}

// Même principe que apps/desktop/src/renderer/src/finances/contexte-bail.ts
// (cascade bail → appartement → immeuble → sci + locataires), sans le
// cache multi-appels : la sélection de bail mobile enrichit une liste
// affichée une seule fois, pas un tableau réévalué en boucle.
export async function chargerContexteBail(bail: Bail): Promise<ContexteBail> {
  const [appartement, liens] = await Promise.all([
    getAppartement(bail.appartementId),
    listBailLocataires(bail.id)
  ]);
  const [immeuble, locataires] = await Promise.all([
    getImmeuble(appartement.immeubleId),
    Promise.all(
      liens
        .filter((lien) => lien.archivedAt === null)
        .map((lien) => getLocataire(lien.locataireId).catch(() => null))
    )
  ]);
  const sci = await getSci(immeuble.sciId);

  return {
    sciNom: sci.nom,
    immeubleNom: immeuble.nom,
    appartementNumero: appartement.numero,
    locatairesNoms: locataires
      .filter((l): l is NonNullable<typeof l> => l !== null)
      .map((l) => `${l.prenom} ${l.nom}`)
      .join(", ")
  };
}
