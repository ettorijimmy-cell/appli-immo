const JOURS_PAR_MOIS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function estBissextile(annee: number): boolean {
  return (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0;
}

// Calcul purement arithmétique (pas de Date native) : packages/core reste
// TypeScript pur, et les fuseaux horaires de Date introduiraient un
// comportement dépendant de la machine sur un calcul qui n'en a pas besoin.
export function joursDansLeMois(annee: number, mois: number): number {
  if (mois === 2 && estBissextile(annee)) {
    return 29;
  }
  return JOURS_PAR_MOIS[mois - 1] as number;
}

export function formaterDateIso(annee: number, mois: number, jour: number): string {
  return `${annee.toString().padStart(4, "0")}-${mois.toString().padStart(2, "0")}-${jour.toString().padStart(2, "0")}`;
}

export function decomposerDate(date: string): { annee: number; mois: number; jour: number } {
  const [anneeStr, moisStr, jourStr] = date.split("-");
  return { annee: Number(anneeStr), mois: Number(moisStr), jour: Number(jourStr) };
}

/**
 * Numéro de jour ordinal (arithmétique pure, aucun `Date` natif) — jours
 * écoulés depuis une origine arbitraire (l'an 1), croissant strictement
 * avec la date. Ne sert jamais à afficher une date, uniquement à comparer
 * ou soustraire deux dates ISO (ex. compter des jours occupés sur une
 * période, Module 7).
 */
export function dateVersJourOrdinal(date: string): number {
  const { annee, mois, jour } = decomposerDate(date);
  let jours = jour - 1;
  for (let m = 1; m < mois; m++) {
    jours += joursDansLeMois(annee, m);
  }
  for (let a = 1; a < annee; a++) {
    jours += estBissextile(a) ? 366 : 365;
  }
  return jours;
}

/**
 * Ajoute (ou retranche, si négatif) un nombre de jours à une date ISO,
 * sans `Date` native (voir joursDansLeMois ci-dessus). Utilisé pour le
 * délai de grâce de l'alerte `impaye` (Module 6, docs/backlog.md).
 */
export function ajouterJours(date: string, jours: number): string {
  let { annee, mois, jour } = decomposerDate(date);
  jour += jours;
  while (jour > joursDansLeMois(annee, mois)) {
    jour -= joursDansLeMois(annee, mois);
    mois += 1;
    if (mois > 12) {
      mois = 1;
      annee += 1;
    }
  }
  while (jour < 1) {
    mois -= 1;
    if (mois < 1) {
      mois = 12;
      annee -= 1;
    }
    jour += joursDansLeMois(annee, mois);
  }
  return formaterDateIso(annee, mois, jour);
}

/**
 * Ajoute un nombre de mois à une date ISO. Le jour du mois est conservé
 * tel quel s'il existe dans le mois cible, sinon ramené à son dernier jour
 * (ex. 2026-01-31 + 1 mois -> 2026-02-28, jamais 2026-03-03). Utilisé pour
 * la prochaine date d'entretien d'un équipement (Module 6,
 * `date_dernier_entretien + intervalle_entretien_mois`).
 */
export function ajouterMois(date: string, mois: number): string {
  const decomposed = decomposerDate(date);
  const totalMois = decomposed.mois - 1 + mois;
  const anneeCible = decomposed.annee + Math.floor(totalMois / 12);
  const moisCible = (((totalMois % 12) + 12) % 12) + 1;
  const jourCible = Math.min(decomposed.jour, joursDansLeMois(anneeCible, moisCible));
  return formaterDateIso(anneeCible, moisCible, jourCible);
}

const LIBELLES_MOIS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre"
];

/**
 * Nom du mois en toutes lettres, en français — mention "chaque année le
 * 01 {mois}" du modèle de bail (date de révision du loyer).
 */
export function libelleMoisDepuisDate(date: string): string {
  const { mois } = decomposerDate(date);
  return LIBELLES_MOIS[mois - 1] as string;
}
