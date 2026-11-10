// Montant en chiffres, à la française, pour un acte (acte de
// cautionnement, chantier garants : « 23 400,00 € ») : centimes entiers en
// entrée, jamais un nombre flottant (même principe que montantEnLettres).
// Milliers séparés par une espace insécable (U+00A0), deux décimales après
// une virgule. Le symbole « € » reste dans le modèle Word.

const ESPACE_INSECABLE = " ";

export function formaterMontantChiffres(centimes: number): string {
  if (!Number.isInteger(centimes) || centimes < 0) {
    throw new Error(`Montant en centimes invalide : ${centimes}`);
  }
  const euros = Math.floor(centimes / 100).toString();
  const cents = (centimes % 100).toString().padStart(2, "0");
  const milliers = euros.replace(/\B(?=(\d{3})+(?!\d))/g, ESPACE_INSECABLE);
  return `${milliers},${cents}`;
}
