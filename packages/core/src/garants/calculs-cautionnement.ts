// Montants et dates de l'acte de cautionnement (chantier garants,
// décisions du 2026-11-08, tmp/decisions-garants.md). Fonctions pures,
// sans I/O : dates ISO (AAAA-MM-JJ) traitées par l'arithmétique de
// dates/calendrier, jamais par un Date natif ; montants en centimes
// entiers, jamais en flottants.
import { calculerDureeBail, type ChoixDureeBail } from "../baux/calculer-duree-bail";
import { calculerMontantEcheanceLoyer } from "../baux/echeances";
import { ajouterJours, ajouterMois, decomposerDate, joursDansLeMois } from "../dates/calendrier";
import { centimesVersMontant, montantEnCentimes } from "../paiements/montant";

// Plafond de l'engagement de la caution : 36 mois de loyer, charges
// comprises (décision du 2026-11-08).
export const PLAFOND_CAUTIONNEMENT_MOIS = 36;

// Fin du bail initial plus 2 renouvellements (décision du 2026-11-08).
export const RENOUVELLEMENTS_COUVERTS_PAR_LA_CAUTION = 2;

// Délai maximal après la date d'effet du congé du colocataire garanti
// (loi n° 89-462, art. 8-1, VI).
export const DELAI_FIN_ENGAGEMENT_COLOCATION_MOIS = 6;

// Ces dates alimentent un acte juridique : une date mal formée doit lever
// une erreur, jamais produire silencieusement une date fausse (dates/
// calendrier ne vérifie rien).
function verifierDateIso(nom: string, date: string): void {
  const correspondance = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const valide =
    correspondance !== null &&
    Number(correspondance[2]) >= 1 &&
    Number(correspondance[2]) <= 12 &&
    Number(correspondance[3]) >= 1 &&
    Number(correspondance[3]) <= joursDansLeMois(Number(correspondance[1]), Number(correspondance[2]));
  if (!valide) {
    throw new Error(`${nom} invalide (date AAAA-MM-JJ attendue) : "${date}"`);
  }
}

function verifierCentimes(nom: string, valeur: number): void {
  if (!Number.isInteger(valeur) || valeur < 0) {
    throw new Error(`${nom} invalide (centimes entiers positifs ou nuls attendus) : ${valeur}`);
  }
}

/**
 * Plafond de l'engagement : 36 × (loyer hors charges + provisions de
 * charges), en centimes entiers. La somme mensuelle est exactement celle
 * de calculerMontantEcheanceLoyer (loyer + provisions), réutilisée ici
 * pour ne jamais avoir deux définitions du « loyer charges comprises ».
 */
export function calculerPlafondCautionnement(loyerCentimes: number, chargesCentimes: number): number {
  verifierCentimes("Loyer", loyerCentimes);
  verifierCentimes("Provisions de charges", chargesCentimes);
  const mensuel = montantEnCentimes(
    calculerMontantEcheanceLoyer(centimesVersMontant(loyerCentimes), centimesVersMontant(chargesCentimes))
  );
  return PLAFOND_CAUTIONNEMENT_MOIS * mensuel;
}

/**
 * Dernier jour d'une période de `mois` mois commençant le `debut` inclus.
 *
 * Règle : la veille du même quantième, `mois` mois plus tard. Quand ce
 * quantième n'existe pas dans le mois d'arrivée (début un 29 février, un
 * 30 ou un 31), la période se termine le dernier jour de ce mois d'arrivée,
 * sans retrancher de jour : du 29 février 2028, trois ans → 28 février 2031
 * (et non le 27) ; du 31 janvier, un mois → 28 ou 29 février.
 *
 * Fonction prévue pour UNE période : ne pas l'enchaîner pour découper des
 * périodes successives (dans le cas tronqué, sa fin coïncide avec
 * ajouterMois(debut, mois), qui serait le début de la suivante).
 */
export function dernierJourDePeriode(debut: string, mois: number): string {
  verifierDateIso("Date de début", debut);
  if (!Number.isInteger(mois) || mois <= 0) {
    throw new Error(`Durée en mois invalide : ${mois}`);
  }
  const arrivee = ajouterMois(debut, mois);
  const quantiemeTronque = decomposerDate(arrivee).jour < decomposerDate(debut).jour;
  return quantiemeTronque ? arrivee : ajouterJours(arrivee, -1);
}

/**
 * Date de fin de l'engagement de la caution : fin du bail initial plus 2
 * renouvellements, soit date d'effet + 3 × durée du bail, moins un jour
 * (voir dernierJourDePeriode pour un début un 29 février ou un 31). La
 * durée vient de calculerDureeBail (vide : 3 ans pour une SCI familiale ou
 * une personne physique, 6 ans pour une personne morale ; meublé : 1 an).
 *
 * Bail meublé étudiant (9 mois, sans reconduction tacite, art. 25-7) :
 * aucun renouvellement n'existe, la fin d'engagement est donc la fin du
 * bail initial (date d'effet + 9 mois − 1 jour). Cas non tranché par les
 * décisions du 2026-11-08, à confirmer.
 */
export function calculerDateFinEngagementCaution(dateEffetBail: string, choixDuree: ChoixDureeBail): string {
  const duree = calculerDureeBail(choixDuree);
  const periodes = duree.reconductionTacite ? 1 + RENOUVELLEMENTS_COUVERTS_PAR_LA_CAUTION : 1;
  return dernierJourDePeriode(dateEffetBail, periodes * duree.dureeMois);
}

export interface FinEngagementColocation {
  // Fin de l'engagement si un nouveau colocataire figure au bail : la date
  // d'effet du congé du colocataire garanti.
  siRemplace: string;
  // Fin au plus tard, sans remplaçant : date d'effet du congé + 6 mois.
  auPlusTard: string;
}

/**
 * Fin de l'engagement de la caution d'un colocataire qui a donné congé
 * (loi n° 89-462, art. 8-1, VI). Le remplacement n'est pas détecté
 * automatiquement (décision du 2026-11-08) : les deux dates sont
 * renvoyées, l'écran affiche la règle.
 *
 * Règle pour « + 6 mois » : même quantième six mois plus tard ; s'il
 * n'existe pas dans le mois d'arrivée, dernier jour de ce mois (31 août
 * + 6 mois → 28 février, ou 29 une année bissextile). Pas de « − 1 jour »,
 * conformément à la décision du 2026-11-08 (« congé + 6 mois »).
 */
export function calculerFinEngagementColocation(dateEffetConge: string): FinEngagementColocation {
  verifierDateIso("Date d'effet du congé", dateEffetConge);
  return {
    siRemplace: dateEffetConge,
    auPlusTard: ajouterMois(dateEffetConge, DELAI_FIN_ENGAGEMENT_COLOCATION_MOIS)
  };
}
