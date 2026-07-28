import { centimesVersMontant, montantEnCentimes } from "../paiements/montant";

const JOURS_PAR_MOIS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function estBissextile(annee: number): boolean {
  return (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0;
}

// Calcul purement arithmétique (pas de Date native) : packages/core reste
// TypeScript pur, et les fuseaux horaires de Date introduiraient un
// comportement dépendant de la machine sur un calcul qui n'en a pas besoin.
function joursDansLeMois(annee: number, mois: number): number {
  if (mois === 2 && estBissextile(annee)) {
    return 29;
  }
  return JOURS_PAR_MOIS[mois - 1] as number;
}

function formaterDateIso(annee: number, mois: number, jour: number): string {
  return `${annee.toString().padStart(4, "0")}-${mois.toString().padStart(2, "0")}-${jour.toString().padStart(2, "0")}`;
}

/**
 * Montant de l'échéance de loyer : loyer hors charges + provisions pour
 * charges (docs/data-dictionary.md, section baux). `provisionsCharges` nul
 * ou absent compte pour 0.
 */
export function calculerMontantEcheanceLoyer(loyerMensuel: string, provisionsCharges: string | null): string {
  const centimes = montantEnCentimes(loyerMensuel) + (provisionsCharges ? montantEnCentimes(provisionsCharges) : 0);
  return centimesVersMontant(centimes);
}

/**
 * Date de la première échéance de loyer à l'activation d'un bail
 * (docs/data-dictionary.md, section baux, "Décision produit — génération
 * des échéances à l'activation") : le jour d'activation est comparé à
 * `jourEcheance` avec un ≤ — encore inférieur ou égal, l'échéance tombe ce
 * mois-ci ; sinon le mois suivant. L'égalité est traitée comme "pas encore
 * passé" pour ne jamais faire sauter un mois entier d'obligation de loyer
 * pile le jour de l'échéance.
 */
export function calculerDatePremiereEcheance(dateActivation: string, jourEcheance: number): string {
  const [anneeStr, moisStr, jourStr] = dateActivation.split("-");
  const annee = Number(anneeStr);
  const mois = Number(moisStr);
  const jourActivation = Number(jourStr);

  if (jourActivation <= jourEcheance) {
    return formaterDateIso(annee, mois, jourEcheance);
  }
  const moisSuivant = mois === 12 ? 1 : mois + 1;
  const anneeMoisSuivant = mois === 12 ? annee + 1 : annee;
  return formaterDateIso(anneeMoisSuivant, moisSuivant, jourEcheance);
}

/**
 * Prorata temporis de l'échéance de loyer du mois de résiliation
 * (docs/data-dictionary.md, section baux, "Décision produit — prorata à la
 * résiliation") : jours_occupes / jours_du_mois, jours_occupes comptant du
 * début du mois calendaire jusqu'à `dateFin` INCLUS (le jour du départ est
 * facturé en entier). Troncature à deux décimales, jamais d'arrondi
 * flottant — même convention que montantEnCentimes.
 */
export function calculerProrataResiliation(montantMensuel: string, dateFin: string): string {
  const [anneeStr, moisStr, jourStr] = dateFin.split("-");
  const annee = Number(anneeStr);
  const mois = Number(moisStr);
  const joursOccupes = Number(jourStr);

  const centimesMensuel = montantEnCentimes(montantMensuel);
  const centimesProrata = Math.trunc((centimesMensuel * joursOccupes) / joursDansLeMois(annee, mois));
  return centimesVersMontant(centimesProrata);
}

/**
 * Bornes du mois calendaire contenant `dateReference` (borne de fin
 * exclusive), pour retrouver l'échéance de loyer à proratiser à la
 * résiliation (docs/data-dictionary.md, section baux) sans avoir à
 * comparer des dates au niveau du service.
 */
export function calculerBornesMoisCalendaire(dateReference: string): {
  debutMoisInclus: string;
  debutMoisSuivantExclusif: string;
} {
  const [anneeStr, moisStr] = dateReference.split("-");
  const annee = Number(anneeStr);
  const mois = Number(moisStr);
  const moisSuivant = mois === 12 ? 1 : mois + 1;
  const anneeMoisSuivant = mois === 12 ? annee + 1 : annee;
  return {
    debutMoisInclus: formaterDateIso(annee, mois, 1),
    debutMoisSuivantExclusif: formaterDateIso(anneeMoisSuivant, moisSuivant, 1)
  };
}
