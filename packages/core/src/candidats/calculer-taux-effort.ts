import { montantEnCentimes } from "../paiements/montant";

/**
 * Taux d'effort d'un candidat locataire (loyerVise / revenuMensuelNet × 100),
 * purement informatif — aucun seuil "acceptable" codé en dur, ce n'est pas
 * à l'application de juger un candidat, seulement d'afficher le chiffre
 * (module Calendrier/Candidats, 2026-09-15). Retourné en centimes entiers
 * (même convention que montantEnCentimes : un taux de 33,33 % est renvoyé
 * en 3333) pour ne jamais arrondir un pourcentage financier en flottant
 * avant son tout dernier affichage.
 *
 * Retourne `null` dès que l'une des deux données est absente ou que le
 * revenu est nul — jamais de division par zéro, jamais de calcul trompeur
 * sur une donnée incomplète.
 */
export function calculerTauxEffort(loyerVise: string | null, revenuMensuelNet: string | null): number | null {
  if (loyerVise === null || revenuMensuelNet === null) {
    return null;
  }
  const revenuCentimes = montantEnCentimes(revenuMensuelNet);
  if (revenuCentimes === 0) {
    return null;
  }
  const loyerCentimes = montantEnCentimes(loyerVise);
  return Math.round((loyerCentimes / revenuCentimes) * 100 * 100);
}
