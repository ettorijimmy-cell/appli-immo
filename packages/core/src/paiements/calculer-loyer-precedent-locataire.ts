import { decomposerDate } from "../dates/calendrier";

export interface BailPrecedent {
  loyerMensuel: string | null;
  dateFin: string | null;
}

/**
 * Mention obligatoire du contrat-type (section IV) : le loyer acquitté par
 * le précédent locataire, uniquement si son départ remonte à moins de 18
 * mois avant le début du nouveau bail. Différence en mois calendaires
 * entiers (année/mois, jour ignoré) — suffisant pour ce seuil, cohérent
 * avec la nature de la règle (pas une précision jour-par-jour).
 */
export function calculerLoyerPrecedentLocataire(
  bailPrecedent: BailPrecedent | null,
  nouvelleDateDebut: string
): string | null {
  if (!bailPrecedent || !bailPrecedent.loyerMensuel || !bailPrecedent.dateFin) {
    return null;
  }

  const fin = decomposerDate(bailPrecedent.dateFin);
  const debut = decomposerDate(nouvelleDateDebut);
  const moisEcoules = (debut.annee - fin.annee) * 12 + (debut.mois - fin.mois);

  if (moisEcoules < 0 || moisEcoules >= 18) {
    return null;
  }

  return bailPrecedent.loyerMensuel;
}
