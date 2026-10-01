import { centimesVersMontant, montantEnCentimes } from "../paiements/montant";

export type SensBilanRegularisation = "faveur_locataire" | "faveur_proprietaire" | "equilibre";

export interface BilanRegularisation {
  solde: string;
  sens: SensBilanRegularisation;
}

/**
 * Compare les provisions pour charges perçues aux charges réelles sur la
 * période d'un bail (Module Régularisation des charges, Sous-commit C,
 * docs/backlog.md). Calcul en centimes entiers, jamais en flottant (voir
 * CLAUDE.md). `solde` est toujours une valeur positive (ou "0.00") — jamais
 * signée — même convention que BauxService.resilier() pour le trop-perçu :
 * c'est `sens` qui porte la direction, pas le signe de `solde`.
 */
export function calculerBilanRegularisation(provisionsRecues: string, chargesReelles: string): BilanRegularisation {
  const centimesProvisions = montantEnCentimes(provisionsRecues);
  const centimesCharges = montantEnCentimes(chargesReelles);
  const centimesSolde = centimesProvisions - centimesCharges;

  if (centimesSolde === 0) {
    return { solde: "0.00", sens: "equilibre" };
  }

  const sens: SensBilanRegularisation = centimesSolde > 0 ? "faveur_locataire" : "faveur_proprietaire";
  return { solde: centimesVersMontant(Math.abs(centimesSolde)), sens };
}
