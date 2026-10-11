// Libellé chiffré ("3 ans", "1 an", "9 mois") pour les mentions de durée
// du contrat-type — distinct de `DureeBailLegale.duree` (libellé en
// toutes lettres, "trois ans") utilisé par `texteLegal`. La valeur
// source reste toujours `dureeMois` produit par `calculerDureeBail`,
// jamais une durée réécrite en dur par régime.
export function formaterDureeBail(dureeMois: number): string {
  if (dureeMois % 12 === 0) {
    const annees = dureeMois / 12;
    return annees === 1 ? "1 an" : `${annees} ans`;
  }
  return `${dureeMois} mois`;
}
