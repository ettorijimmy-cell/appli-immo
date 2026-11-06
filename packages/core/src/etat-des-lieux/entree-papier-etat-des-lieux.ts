// Règles de la déclaration d'une entrée d'état des lieux établie et signée
// sur papier (2026-11-06). Partagées entre le backend (refus) et le
// desktop (formulaire), jamais dupliquées.

import { ajouterMois, decomposerDate, formaterDateCourteFr, formaterDateIso, joursDansLeMois } from "../dates/calendrier";

// Un seul PDF, plusieurs pages possibles. Plafond choisi pour laisser de la
// place au PDF de sortie dans un même mail (décision 7, contrôle de taille
// global à l'envoi).
export const TAILLE_MAX_SCAN_ENTREE_PAPIER_OCTETS = 10 * 1024 * 1024;

// Signature d'un fichier PDF ("%PDF-"), lue sur le contenu, jamais sur le
// nom ni sur le type annoncé par le client.
const ENTETE_PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];

export function contenuEstUnPdf(octets: Uint8Array): boolean {
  return octets.length >= ENTETE_PDF.length && ENTETE_PDF.every((octet, i) => octets[i] === octet);
}

function dateIsoValide(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }
  const { annee, mois, jour } = decomposerDate(date);
  return mois >= 1 && mois <= 12 && jour >= 1 && jour <= joursDansLeMois(annee, mois);
}

// Refus bloquant de la date portée sur le papier : invalide, ou dans le
// futur (par rapport à la date du jour à Paris, fournie par l'appelant).
// null si la date est acceptée.
export function refusDateEntreePapier(dateSignature: string, aujourdHui: string): string | null {
  if (!dateIsoValide(dateSignature)) {
    return "La date de l'état des lieux d'entrée papier est invalide.";
  }
  const { annee, mois, jour } = decomposerDate(dateSignature);
  if (formaterDateIso(annee, mois, jour) > aujourdHui) {
    return "La date de l'état des lieux d'entrée papier ne peut pas être dans le futur.";
  }
  return null;
}

// Avertissement NON bloquant : la date du papier s'écarte de plus d'un mois
// (calendaire) de la date de début du bail. null sinon.
export function avertissementDateEntreePapier(dateSignature: string, dateDebutBail: string): string | null {
  const borneBasse = ajouterMois(dateDebutBail, -1);
  const borneHaute = ajouterMois(dateDebutBail, 1);
  if (dateSignature >= borneBasse && dateSignature <= borneHaute) {
    return null;
  }
  return `La date de l'état des lieux d'entrée (${formaterDateCourteFr(dateSignature)}) s'écarte de plus d'un mois du début du bail (${formaterDateCourteFr(dateDebutBail)}).`;
}
