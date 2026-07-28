import { ajouterJours, ajouterMois } from "../dates/calendrier";
import type { StatutDocument } from "../documents/calculer-statut-document";

/**
 * Règle bail_fin_proche (docs/data-dictionary.md, section alertes) :
 * se déclenche dès que la date de référence atteint (dateFin - seuilJours),
 * et reste vraie ensuite indéfiniment (même après dateFin, tant que le bail
 * n'a pas été traité/résilié) — jamais de fenêtre de fin, seulement de
 * début, pour ne jamais faire disparaître silencieusement une alerte non
 * traitée.
 */
export function calculerAlerteBailFinProche(
  dateFin: string | null,
  seuilJours: number,
  dateReference: string
): boolean {
  if (dateFin === null) {
    return false;
  }
  return dateReference >= ajouterJours(dateFin, -seuilJours);
}

/**
 * Règle document_expire : réutilise tel quel le statut calculé par
 * calculerStatutDocument (Module 4) — aucune logique propre, un document
 * est expiré ou ne l'est pas.
 */
export function calculerAlerteDocumentExpire(statutDocument: StatutDocument): boolean {
  return statutDocument === "expire";
}

/**
 * Règle document_expire_proche : uniquement tant que le document est
 * encore `valide` (jamais en même temps que document_expire, qui prend le
 * relais une fois la date dépassée — voir calculerStatutDocument).
 */
export function calculerAlerteDocumentExpireProche(
  dateExpiration: string | null,
  statutDocument: StatutDocument,
  seuilJours: number,
  dateReference: string
): boolean {
  if (dateExpiration === null || statutDocument !== "valide") {
    return false;
  }
  return dateReference >= ajouterJours(dateExpiration, -seuilJours);
}

/**
 * Prochaine date d'entretien attendue d'un équipement : date_dernier_entretien
 * + intervalle_entretien_mois (docs/data-dictionary.md, section equipements).
 */
export function calculerProchaineDateEntretien(dateDernierEntretien: string, intervalleMois: number): string {
  return ajouterMois(dateDernierEntretien, intervalleMois);
}

/**
 * Règle entretien_equipement : ne se déclenche jamais si l'un des deux
 * champs (date_dernier_entretien, intervalle_entretien_mois) est absent —
 * pas de valeur par défaut implicite (docs/data-dictionary.md).
 */
export function calculerAlerteEntretienEquipement(
  dateDernierEntretien: string | null,
  intervalleMois: number | null,
  seuilJours: number,
  dateReference: string
): boolean {
  if (dateDernierEntretien === null || intervalleMois === null) {
    return false;
  }
  const prochaineDate = calculerProchaineDateEntretien(dateDernierEntretien, intervalleMois);
  return dateReference >= ajouterJours(prochaineDate, -seuilJours);
}

/**
 * Règle impaye : `seuilJours` est ici un délai de GRÂCE après
 * `dateEcheance`, pas un délai d'anticipation avant (sens inversé par
 * rapport aux trois autres règles — voir docs/data-dictionary.md, section
 * alertes, pour la raison). Le dernier jour du délai de grâce est encore
 * toléré (même convention que calculerStatutDocument : le jour J est
 * encore "dans les temps", l'alerte ne se déclenche qu'à partir du
 * lendemain) — comparaison stricte, pas `>=`.
 *
 * Ne filtre PAS par statut/type de paiement : c'est la responsabilité de
 * l'appelant (seuls les paiements impaye/partiel de type loyer/charges
 * doivent être soumis à cette fonction), cohérent avec la séparation
 * requête/règle pure déjà en place pour proposerRapprochements.
 */
export function calculerAlerteImpaye(dateEcheance: string, seuilJoursGrace: number, dateReference: string): boolean {
  return dateReference > ajouterJours(dateEcheance, seuilJoursGrace);
}
