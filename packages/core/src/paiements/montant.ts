/**
 * Normalise un montant saisi ou importé (virgule OU point décimal, espaces
 * de séparation de milliers) vers un format canonique unique (point
 * décimal, sans espace). Seule définition de "comment interpréter un
 * montant en euros" dans tout le code — utilisée aussi bien pour la
 * conversion interne (montantEnCentimes) que pour la validation d'entrée
 * (DTO paiements, apps/backend) et la confirmation d'un rapprochement CSV
 * (apps/desktop), pour ne jamais dupliquer cette interprétation.
 */
export function normaliserMontant(montant: string): string {
  return montant.trim().replace(/\s/g, "").replace(",", ".");
}

/**
 * Convertit un montant décimal (chaîne, jamais un nombre flottant — voir
 * CLAUDE.md/docs/backlog.md, "erreur ici = erreur financière") en centimes
 * entiers. Manipulation purement textuelle : aucune multiplication en
 * virgule flottante, pour ne jamais introduire d'imprécision sur une somme
 * d'argent.
 */
export function montantEnCentimes(montant: string): number {
  const normalise = normaliserMontant(montant);
  const negatif = normalise.startsWith("-");
  const sansSigne = negatif ? normalise.slice(1) : normalise;

  const [partieEntiere = "0", partieDecimale = ""] = sansSigne.split(".");
  if (!/^\d+$/.test(partieEntiere) || !/^\d*$/.test(partieDecimale)) {
    throw new Error(`Montant invalide : "${montant}"`);
  }

  const decimalDeuxChiffres = (partieDecimale + "00").slice(0, 2);
  const centimes = parseInt(partieEntiere, 10) * 100 + parseInt(decimalDeuxChiffres, 10);
  return negatif ? -centimes : centimes;
}

/**
 * Conversion inverse de montantEnCentimes — formate des centimes entiers en
 * chaîne décimale à point (jamais de division flottante : les centimes
 * restent des entiers jusqu'au tout dernier formatage textuel).
 */
export function centimesVersMontant(centimes: number): string {
  const negatif = centimes < 0;
  const valeurAbsolue = Math.abs(centimes);
  const partieEntiere = Math.trunc(valeurAbsolue / 100);
  const partieDecimale = valeurAbsolue % 100;
  return `${negatif ? "-" : ""}${partieEntiere}.${partieDecimale.toString().padStart(2, "0")}`;
}
