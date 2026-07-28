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
 * Prorata temporis d'un mois calendaire partiellement occupé
 * (docs/data-dictionary.md, section baux) : jours_occupes / jours_du_mois,
 * jours_occupes comptant du début du mois calendaire jusqu'à `dateFin`
 * INCLUS (le dernier jour occupé est facturé en entier). Troncature à deux
 * décimales, jamais d'arrondi flottant — même convention que
 * montantEnCentimes.
 *
 * Utilisée à la fois pour la fin d'occupation (résiliation) et,
 * indirectement via `calculerMontantEcheanceEntree`, pour le début
 * d'occupation (entrée dans les lieux) — d'où son nom générique plutôt que
 * limité à la résiliation.
 *
 * `dateDebutOccupation` (optionnel) permet de proratiser aussi le DÉBUT du
 * mois occupé, pas seulement sa fin : nécessaire quand aucune échéance
 * n'a encore été générée pour ce mois (voir BauxService.resilier(),
 * "Cas B"). Si `dateDebutOccupation` tombe dans un mois calendaire
 * ANTÉRIEUR à `dateFin`, le mois de `dateFin` est considéré occupé depuis
 * son premier jour (comportement identique à l'appel à deux arguments). Si
 * le nombre de jours occupés calculé est négatif (dateDebutOccupation
 * postérieure à dateFin dans le même mois), il est ramené à 0 plutôt que de
 * produire un montant négatif.
 */
export function calculerProrataOccupationPartielle(
  montantMensuel: string,
  dateFin: string,
  dateDebutOccupation?: string
): string {
  const [anneeStr, moisStr, jourStr] = dateFin.split("-");
  const annee = Number(anneeStr);
  const mois = Number(moisStr);
  const jourFin = Number(jourStr);

  let jourDebut = 1;
  if (dateDebutOccupation) {
    const [anneeDebutStr, moisDebutStr, jourDebutStr] = dateDebutOccupation.split("-");
    // Ne s'applique que si le début d'occupation tombe dans le MÊME mois
    // calendaire que dateFin : sinon (mois antérieur), ce mois-ci a été
    // occupé depuis son premier jour, comme avant.
    if (Number(anneeDebutStr) === annee && Number(moisDebutStr) === mois) {
      jourDebut = Number(jourDebutStr);
    }
  }

  const joursOccupes = Math.max(0, jourFin - jourDebut + 1);
  const centimesMensuel = montantEnCentimes(montantMensuel);
  const centimesProrata = Math.trunc((centimesMensuel * joursOccupes) / joursDansLeMois(annee, mois));
  return centimesVersMontant(centimesProrata);
}

/**
 * Dernier jour calendaire du mois contenant `date` (ex. "2026-02-15" ->
 * "2026-02-28"), pour proratiser une échéance d'entrée qui se termine à la
 * fin du mois de date_debut.
 */
export function calculerDernierJourDuMois(date: string): string {
  const [anneeStr, moisStr] = date.split("-");
  const annee = Number(anneeStr);
  const mois = Number(moisStr);
  return formaterDateIso(annee, mois, joursDansLeMois(annee, mois));
}

/**
 * Montant de la première échéance de loyer à l'activation d'un bail
 * (docs/data-dictionary.md, section baux, "Décision produit — génération
 * des échéances à l'activation") : chaque échéance correspond à un mois
 * calendaire complet ; seule la première est proratisée si `dateDebut` ne
 * tombe pas le 1er du mois, du 1er jour d'occupation jusqu'à la fin de ce
 * mois calendaire. Si `dateDebut` est le 1er, le mois est dû en entier —
 * `calculerProrataOccupationPartielle` produit ce résultat sans branche
 * spéciale (jours_occupes = jours_du_mois exactement).
 *
 * `jourEcheance` n'intervient JAMAIS dans ce calcul (ni le montant, ni la
 * date d'exigibilité, qui est `dateDebut` lui-même) : son seul rôle est
 * d'ancrer les échéances RÉCURRENTES futures, une fois le job du Module 6
 * construit — jamais la toute première.
 */
export function calculerMontantEcheanceEntree(
  loyerMensuel: string,
  provisionsCharges: string | null,
  dateDebut: string
): string {
  const montantPlein = calculerMontantEcheanceLoyer(loyerMensuel, provisionsCharges);
  const dernierJourDuMois = calculerDernierJourDuMois(dateDebut);
  return calculerProrataOccupationPartielle(montantPlein, dernierJourDuMois, dateDebut);
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
