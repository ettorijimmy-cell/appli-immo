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
 * Détecte un montant négatif — manipulation purement textuelle (jamais de
 * comparaison numérique sur un flottant). Sert à distinguer, dans une ligne
 * de relevé CSV déjà parsée (`parserReleveCsv`), un débit (négatif — un
 * encaissement, `montant` positif, n'est jamais une dépense) avant de
 * proposer la ligne comme candidate de dépense (voir
 * `ImportCsvDepensesView`, apps/desktop) — ce filtrage vit dans le flux
 * dépenses, jamais dans `parserReleveCsv` lui-même (qui reste un parseur
 * générique, sans notion de dépense).
 */
export function estMontantNegatif(montant: string): boolean {
  return normaliserMontant(montant).startsWith("-");
}

/**
 * Retire un signe négatif éventuel — manipulation purement textuelle,
 * jamais Math.abs sur un flottant. Sert à convertir une ligne de débit d'un
 * relevé bancaire (montant négatif signé, convention de
 * `parserReleveCsv`/`proposerRapprochements`) vers un montant de dépense
 * (toujours positif, voir `depense.montant`, docs/data-dictionary.md) —
 * les deux domaines ont des conventions de signe différentes et ne doivent
 * jamais être confondus silencieusement.
 */
export function valeurAbsolueMontant(montant: string): string {
  return normaliserMontant(montant).replace(/^-/, "");
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
