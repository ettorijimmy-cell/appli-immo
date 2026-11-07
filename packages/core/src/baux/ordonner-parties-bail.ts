// Ordre d'impression des parties dans le bail généré (décisions du
// 2026-11-07) :
// - locataires : le titulaire d'abord, puis les colocataires dans l'ordre
//   de saisie de leur rattachement au bail ;
// - garants : dans l'ordre de saisie.
// « Ordre de saisie » = created_at croissant, puis id croissant à égalité
// (UUID v7, ordonné dans le temps) : jamais l'ordre de retour de la base,
// qui n'est garanti par rien sans ORDER BY.
// Fonctions pures, sans dépendance au schéma : le backend leur passe ses
// lignes telles quelles, elles sont renvoyées dans un nouveau tableau.

export interface PartieSaisie {
  id: string;
  createdAt: Date | string;
}

export interface LienLocataireBail extends PartieSaisie {
  role: "titulaire" | "colocataire";
}

function comparerOrdreDeSaisie(a: PartieSaisie, b: PartieSaisie): number {
  const ecart = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  if (ecart !== 0) {
    return ecart;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function ordonnerGarantsDuBail<T extends PartieSaisie>(garants: readonly T[]): T[] {
  return [...garants].sort(comparerOrdreDeSaisie);
}

export function ordonnerLocatairesDuBail<T extends LienLocataireBail>(liens: readonly T[]): T[] {
  return [...liens].sort((a, b) => {
    const rangA = a.role === "titulaire" ? 0 : 1;
    const rangB = b.role === "titulaire" ? 0 : 1;
    return rangA !== rangB ? rangA - rangB : comparerOrdreDeSaisie(a, b);
  });
}
