import { montantEnCentimes, normaliserMontant } from "./montant";

/**
 * Plafond par défaut d'un montant saisi : celui d'une colonne
 * `decimal(10,2)` (99 999 999,99 €), type de la quasi-totalité des montants
 * du schéma. Au-delà, Postgres refuse l'écriture (500 au lieu d'un 400
 * lisible). Un champ stocké plus large (ex. `bien.valeur_acquisition`,
 * `decimal(12,2)`) passe son propre plafond.
 */
export const PLAFOND_MONTANT_SAISI_CENTIMES = 9_999_999_999;

export type RefusMontantSaisi = "format" | "negatif" | "nul" | "trop_grand";

export interface RegleMontantSaisi {
  /** `false` : strictement positif (> 0) ; `true` : positif ou nul (>= 0). */
  zeroAutorise: boolean;
  plafondCentimes?: number;
}

// Après normaliserMontant : un signe moins facultatif (pour pouvoir dire
// « négatif » plutôt que « format »), des chiffres, puis au plus deux
// décimales. Ni « + », ni exposant, ni point sans chiffre de part et
// d'autre.
const FORMAT_MONTANT = /^-?\d+(\.\d{1,2})?$/;

/**
 * Bornes d'un montant saisi (petites suites, décision 3 de Jimmy du
 * 2026-11-22) : `null` s'il est valable, sinon la raison du refus.
 * Manipulation textuelle et en centimes entiers, jamais en virgule
 * flottante. Un signe moins est toujours un refus « négatif », même devant
 * zéro (« -0 », « -0.00 ») : jamais une saisie ambiguë acceptée.
 */
export function verifierMontantSaisi(saisie: string, regle: RegleMontantSaisi): RefusMontantSaisi | null {
  const normalise = normaliserMontant(saisie);
  if (!FORMAT_MONTANT.test(normalise)) {
    return "format";
  }
  if (normalise.startsWith("-")) {
    return "negatif";
  }
  const plafond = regle.plafondCentimes ?? PLAFOND_MONTANT_SAISI_CENTIMES;
  // Comparaison sur la partie entière en texte d'abord : une saisie très
  // longue dépasserait la précision d'un nombre JavaScript.
  const partieEntiere = normalise.split(".")[0]!.replace(/^0+(?=\d)/, "");
  if (partieEntiere.length > String(Math.floor(plafond / 100)).length) {
    return "trop_grand";
  }
  const centimes = montantEnCentimes(normalise);
  if (centimes > plafond) {
    return "trop_grand";
  }
  if (centimes === 0 && !regle.zeroAutorise) {
    return "nul";
  }
  return null;
}
