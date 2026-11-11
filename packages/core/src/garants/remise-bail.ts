// Remise d'un exemplaire du bail à la caution (loi n° 89-462, art. 22-1 :
// « Un exemplaire du contrat de location est remis à la caution »).
// Chantier garants, commit 6 (2026-11-11) : déclaration datée par le
// bailleur, jamais vérifiée ni bloquante ; seulement signalée tant
// qu'elle manque sur un bail signé.
import { decomposerDate, formaterDateIso, joursDansLeMois } from "../dates/calendrier";

// Valeurs de l'enum Postgres garant_remise_bail_mode (migration 0078).
export const MODES_REMISE_BAIL = ["main_propre", "lettre_recommandee", "courrier_simple", "email"] as const;
export type ModeRemiseBail = (typeof MODES_REMISE_BAIL)[number];

export const LIBELLES_MODE_REMISE_BAIL: Record<ModeRemiseBail, string> = {
  main_propre: "En main propre",
  lettre_recommandee: "Lettre recommandée",
  courrier_simple: "Courrier simple",
  email: "E-mail"
};

function dateIsoValide(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }
  const { annee, mois, jour } = decomposerDate(date);
  return mois >= 1 && mois <= 12 && jour >= 1 && jour <= joursDansLeMois(annee, mois);
}

// Refus bloquant de la date de remise déclarée : invalide, ou dans le futur
// (par rapport à la date du jour à Paris, fournie par l'appelant). null si
// la date est acceptée. Une remise antérieure à la signature du bail n'est
// pas refusée : la déclaration est celle du bailleur.
export function refusDateRemiseBail(dateRemise: string, aujourdHui: string): string | null {
  if (!dateIsoValide(dateRemise)) {
    return "La date de remise du bail à la caution est invalide.";
  }
  const { annee, mois, jour } = decomposerDate(dateRemise);
  if (formaterDateIso(annee, mois, jour) > aujourdHui) {
    return "La date de remise du bail à la caution ne peut pas être dans le futur.";
  }
  return null;
}

// Avertissement « Remise du bail non déclarée » : seulement pour une caution
// personne physique non archivée, sans déclaration active, et une fois le
// bail sorti du brouillon (la remise se fait à la signature). Jamais un
// blocage.
export function remiseBailNonDeclareeASignaler(parametres: {
  statutBail: string;
  typeGarantie: string;
  garantArchive: boolean;
  declarationActive: boolean;
}): boolean {
  return (
    parametres.statutBail !== "brouillon" &&
    parametres.typeGarantie === "personne_physique" &&
    !parametres.garantArchive &&
    !parametres.declarationActive
  );
}
