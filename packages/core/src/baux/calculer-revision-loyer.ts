import { centimesVersMontant, montantEnCentimes } from "../paiements/montant";

/**
 * Formule légale de révision annuelle du loyer (art. 17-1, loi n° 89-462) :
 * loyerActuel × indiceReference / indicePrecedent. Signature en `string`,
 * pas en `number` — même convention que `montantEnCentimes`/
 * `centimesVersMontant` et `calculerProrataOccupationPartielle` (calcul de
 * même forme, montant × ratio, packages/core/src/baux/echeances.ts) :
 * conversion en centimes entiers, troncature sur le ratio, jamais de
 * flottant sur le chemin financier. Une révision peut réduire le loyer
 * (indice en baisse), pas seulement l'augmenter.
 */
export function calculerRevisionLoyer(
  loyerActuel: string,
  indiceReference: string,
  indicePrecedent: string
): string {
  const centimesLoyer = montantEnCentimes(loyerActuel);
  // Les indices IRL ont 2 décimales (indices_irl.valeur, precision 6,
  // scale 2) — montantEnCentimes n'a pas de notion de devise, juste "une
  // chaîne à 2 décimales -> un entier de centièmes", directement
  // réutilisable ici.
  const centiemesReference = montantEnCentimes(indiceReference);
  const centiemesPrecedent = montantEnCentimes(indicePrecedent);

  if (centiemesPrecedent <= 0) {
    throw new Error(`indicePrecedent doit être strictement positif, reçu "${indicePrecedent}"`);
  }

  const centimesRevises = Math.trunc((centimesLoyer * centiemesReference) / centiemesPrecedent);
  return centimesVersMontant(centimesRevises);
}
