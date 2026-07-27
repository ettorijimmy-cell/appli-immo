export type StatutAppartement = "vacant" | "loue" | "travaux" | "archive";

export type VerificationActivationBail = { ok: true } | { ok: false; raison: string };

/**
 * Règle de gestion critique (docs/backlog.md, Module 3) : un bail ne peut
 * être activé que si l'appartement est vacant. Empêche à la fois de louer
 * un appartement en travaux et d'activer deux baux simultanément sur le
 * même appartement (le premier bail activé fait déjà passer l'appartement
 * à "loue", ce qui bloque naturellement le second).
 */
export function peutActiverBail(statutAppartementActuel: StatutAppartement): VerificationActivationBail {
  if (statutAppartementActuel !== "vacant") {
    return {
      ok: false,
      raison: `Impossible d'activer ce bail : l'appartement n'est pas vacant (statut actuel : ${statutAppartementActuel}).`
    };
  }
  return { ok: true };
}

/**
 * Règle de gestion critique (docs/backlog.md, Module 3) : la résiliation
 * d'un bail repasse l'appartement à "vacant" — mais UNIQUEMENT s'il était
 * bien "loue". Si le statut a été changé manuellement entre-temps (ex.
 * "travaux", correction de saisie — voir Module 2), la résiliation ne doit
 * jamais l'écraser par inadvertance : la transition automatique ne
 * s'applique qu'à partir de l'état qu'elle a elle-même produit.
 */
export function calculerStatutAppartementApresResiliation(
  statutAppartementActuel: StatutAppartement
): StatutAppartement {
  return statutAppartementActuel === "loue" ? "vacant" : statutAppartementActuel;
}
