import { montantEnCentimes } from "./montant";

export type StatutPaiement = "paye" | "impaye" | "partiel";

/**
 * Règle de gestion (docs/backlog.md, Module 5) : le statut d'un paiement
 * n'est jamais saisi directement, toujours calculé depuis le montant
 * effectivement reçu comparé au montant attendu — voir
 * docs/data-dictionary.md. Comparaison en centimes entiers, jamais en
 * flottant (voir montant.ts).
 */
export function calculerStatutPaiement(montant: string, montantPaye: string | null): StatutPaiement {
  if (montantPaye === null) {
    return "impaye";
  }
  const centimesAttendus = montantEnCentimes(montant);
  const centimesRecus = montantEnCentimes(montantPaye);

  if (centimesRecus <= 0) {
    return "impaye";
  }
  if (centimesRecus >= centimesAttendus) {
    return "paye";
  }
  return "partiel";
}
