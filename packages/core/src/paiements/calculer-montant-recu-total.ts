import { centimesVersMontant, montantEnCentimes } from "./montant";

export interface VersementActif {
  montant: string;
  // `Date` côté backend (ligne Drizzle), `string` côté frontend (JSON sur
  // HTTP, voir apps/desktop/src/renderer/src/finances/api.ts) — seule la
  // comparaison à `null` compte ici, jamais le type exact de la valeur non
  // nulle.
  archivedAt: Date | string | null;
}

/**
 * Somme des versements ACTIFS (non archivés) d'un paiement, en centimes
 * entiers jamais en flottant (docs/backlog.md, "erreur ici = erreur
 * financière") — remplace la lecture directe d'un unique `montant_paye`
 * (docs/data-dictionary.md, section "versements & remboursements"). Un
 * versement archivé (annulé) ne compte jamais dans ce total, même s'il a
 * existé un temps.
 */
export function calculerMontantRecuTotal(versements: VersementActif[]): string {
  const centimes = versements
    .filter((versement) => versement.archivedAt === null)
    .reduce((total, versement) => total + montantEnCentimes(versement.montant), 0);
  return centimesVersMontant(centimes);
}
