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
  bienId: string;
  numero: string;
  nombreChambres: number | null;
  nombreSallesDeBain: number | null;
  nombreWc: number | null;
  autrePiece1: string | null;
  autrePiece2: string | null;
}

// Migration bien (2026-08-26, docs/backlog.md) : remplace Immeuble. nom est
// nullable (obligatoire uniquement pour type='immeuble' côté backend) —
// repli d'affichage bien.nom ?? bien.adresse partout où ce type est
// consommé, jamais un champ vide.
export interface Bien {
  id: string;
  sciId: string | null;
  nom: string | null;
  adresse: string;
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

export function getBien(id: string): Promise<Bien> {
  return authenticatedFetch<Bien>(`/biens/${id}`);
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
  sciNom: string | null;
  bienNom: string;
  appartementNumero: string;
  locatairesNoms: string;
}

// Même principe que apps/desktop/src/renderer/src/finances/contexte-bail.ts
// (cascade bail → appartement → bien → sci + locataires), sans le cache
// multi-appels : la sélection de bail mobile enrichit une liste affichée
// une seule fois, pas un tableau réévalué en boucle. Migration bien
// (2026-08-26) : bien.sciId est nullable (bien en nom propre,
// proprietaireType='personne_physique') — sciNom reste alors null plutôt
// que d'appeler /scis/:id avec un id absent.
export async function chargerContexteBail(bail: Bail): Promise<ContexteBail> {
  const [appartement, liens] = await Promise.all([
    getAppartement(bail.appartementId),
    listBailLocataires(bail.id)
  ]);
  const [bien, locataires] = await Promise.all([
    getBien(appartement.bienId),
    Promise.all(
      liens
        .filter((lien) => lien.archivedAt === null)
        .map((lien) => getLocataire(lien.locataireId).catch(() => null))
    )
  ]);
  const sci = bien.sciId ? await getSci(bien.sciId) : null;

  return {
    sciNom: sci?.nom ?? null,
    bienNom: bien.nom ?? bien.adresse,
    appartementNumero: appartement.numero,
    locatairesNoms: locataires
      .filter((l): l is NonNullable<typeof l> => l !== null)
      .map((l) => `${l.prenom} ${l.nom}`)
      .join(", ")
  };
}
