import { dateVersJourOrdinal } from "../dates/calendrier";

export interface IntervalleOccupationBail {
  dateDebut: string;
  /**
   * `null` = occupation toujours en cours (bail actif/preavis dont la fin
   * n'est pas encore connue), traitée comme se prolongeant au moins
   * jusqu'à la fin de la période demandée. Approximation optimiste
   * assumée pour le cas rare (mais possible, `ResilierBailDto.dateFin` est
   * optionnel) d'un bail déjà `resilie`/`archive` sans `date_fin`
   * renseignée — voir docs/data-dictionary.md, section baux.
   */
  dateFin: string | null;
  /**
   * `null` = bail jamais activé (encore `brouillon`, ou archivé
   * directement depuis `brouillon` sans être jamais passé par `actif`) :
   * aucune occupation réelle n'a jamais eu lieu, exclu du calcul quel que
   * soit `statut` actuel.
   */
  dateActivation: string | null;
}

interface IntervalleOrdinal {
  debut: number;
  fin: number;
}

/**
 * Jours réellement occupés par au moins un bail, sur une période donnée,
 * pour un appartement (docs/data-dictionary.md, section baux — "Taux
 * d'occupation", Module 7). Une vraie UNION d'intervalles, jamais une
 * simple somme des durées : deux baux qui se chevaudraient dans les
 * données (saisie erronée ou chevauchement volontaire lors d'une
 * transition de locataire) ne comptent jamais deux fois le même jour.
 *
 * Un bail `preavis` compte occupé jusqu'à `date_fin` (le logement reste
 * habité pendant le préavis), jamais tronqué à la date du jour — comme
 * n'importe quel bail dont `date_fin` est renseignée, aucun traitement
 * spécial par statut n'est nécessaire ici.
 */
export function calculerJoursOccupes(
  baux: IntervalleOccupationBail[],
  periodeDebut: string,
  periodeFin: string
): number {
  const periodeDebutOrd = dateVersJourOrdinal(periodeDebut);
  const periodeFinOrd = dateVersJourOrdinal(periodeFin);
  if (periodeFinOrd < periodeDebutOrd) {
    return 0;
  }

  const intervalles: IntervalleOrdinal[] = [];
  for (const bail of baux) {
    if (bail.dateActivation === null) {
      continue;
    }
    const debutOrd = Math.max(dateVersJourOrdinal(bail.dateDebut), periodeDebutOrd);
    const finOrd = Math.min(dateVersJourOrdinal(bail.dateFin ?? periodeFin), periodeFinOrd);
    if (debutOrd <= finOrd) {
      intervalles.push({ debut: debutOrd, fin: finOrd });
    }
  }

  intervalles.sort((a, b) => a.debut - b.debut);

  let joursOccupes = 0;
  let finDejaComptee = -Infinity;
  for (const intervalle of intervalles) {
    const debutEffectif = Math.max(intervalle.debut, finDejaComptee + 1);
    if (debutEffectif <= intervalle.fin) {
      joursOccupes += intervalle.fin - debutEffectif + 1;
    }
    finDejaComptee = Math.max(finDejaComptee, intervalle.fin);
  }
  return joursOccupes;
}

/**
 * Taux d'occupation (0 à 1) sur la période — jours occupés (union,
 * `calculerJoursOccupes`) divisés par le nombre de jours de la période.
 */
export function calculerTauxOccupation(
  baux: IntervalleOccupationBail[],
  periodeDebut: string,
  periodeFin: string
): number {
  const joursPeriode = dateVersJourOrdinal(periodeFin) - dateVersJourOrdinal(periodeDebut) + 1;
  if (joursPeriode <= 0) {
    return 0;
  }
  return calculerJoursOccupes(baux, periodeDebut, periodeFin) / joursPeriode;
}
