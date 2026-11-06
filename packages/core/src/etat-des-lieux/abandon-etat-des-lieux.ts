// Abandon d'un brouillon d'état des lieux (décision du 2026-11-05) : motif
// court obligatoire, abandon possible seulement tant qu'aucune phase n'est
// signée. Partagé par le backend (DTO, refus) et le desktop (bouton, saisie).
export const LONGUEUR_MAX_MOTIF_ABANDON = 200;

// Motif tel qu'il sera enregistré (espaces autour retirés), ou null s'il est
// vide ou trop long : le bouton de confirmation reste alors inactif.
export function motifAbandonValide(saisie: string): string | null {
  const motif = saisie.trim();
  return motif !== "" && motif.length <= LONGUEUR_MAX_MOTIF_ABANDON ? motif : null;
}

// Un état des lieux signé (entrée ou sortie) est un acte, jamais un
// brouillon ; un brouillon déjà abandonné ne s'abandonne pas deux fois.
export function brouillonAbandonnable(etat: {
  entreeSigneeParTous: boolean;
  sortieSigneeParTous: boolean;
  archivedAt: string | Date | null;
}): boolean {
  return !etat.entreeSigneeParTous && !etat.sortieSigneeParTous && etat.archivedAt === null;
}
