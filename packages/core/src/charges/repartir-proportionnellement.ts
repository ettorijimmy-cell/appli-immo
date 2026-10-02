export interface PoidsRepartition {
  id: string;
  poids: number;
}

export interface PartRepartition {
  id: string;
  montantCentimes: number;
}

/**
 * Répartit un total en centimes entiers proportionnellement à des poids
 * arbitraires (tantièmes ou surfaces — Module Régularisation des charges,
 * Sous-commit D, docs/backlog.md), par la méthode du plus grand reste :
 * chaque part exacte est d'abord tronquée à l'entier inférieur, puis les
 * centimes non distribués par cette troncature sont attribués un par un
 * aux parts dont le reste fractionnaire était le plus grand — garantit
 * `sum(résultat) === totalCentimes` exactement, jamais une dérive
 * d'arrondi. Déterministe en cas d'égalité de reste : l'ordre d'origine du
 * tableau `poids` tranche (tri stable), jamais un choix arbitraire d'une
 * exécution à l'autre.
 *
 * Un poids à zéro reçoit 0 (jamais une erreur) : son reste fractionnaire
 * est alors nécessairement 0, donc il n'est prioritaire pour aucun centime
 * restant. Si la somme des poids est nulle, aucune répartition
 * proportionnelle n'est mathématiquement possible — retourne des parts
 * nulles si `totalCentimes` l'est aussi (rien à répartir), lève une erreur
 * explicite sinon (jamais une division par zéro silencieuse). `poids`
 * venant toujours de `appartements.tantieme`/`appartements.surface`
 * (jamais négatifs en pratique, contrainte applicative en amont), aucune
 * garde-fou sur un poids négatif ici.
 */
export function repartirProportionnellement(totalCentimes: number, poids: PoidsRepartition[]): PartRepartition[] {
  if (poids.length === 0) {
    return [];
  }

  const totalPoids = poids.reduce((somme, p) => somme + p.poids, 0);
  if (totalPoids <= 0) {
    if (totalCentimes === 0) {
      return poids.map((p) => ({ id: p.id, montantCentimes: 0 }));
    }
    throw new Error("Impossible de répartir un montant non nul : la somme des poids est nulle.");
  }

  const parts = poids.map((p) => {
    const exact = (totalCentimes * p.poids) / totalPoids;
    const plancher = Math.floor(exact);
    return { id: p.id, plancher, reste: exact - plancher };
  });

  const sommeDesPlanchers = parts.reduce((somme, part) => somme + part.plancher, 0);
  let centimesRestants = totalCentimes - sommeDesPlanchers;

  const ordreParReste = parts
    .map((part, index) => ({ ...part, index }))
    .sort((a, b) => b.reste - a.reste || a.index - b.index);

  const montantsParId = new Map(parts.map((part) => [part.id, part.plancher]));
  for (let i = 0; i < ordreParReste.length && centimesRestants > 0; i++) {
    const id = ordreParReste[i]!.id;
    montantsParId.set(id, (montantsParId.get(id) ?? 0) + 1);
    centimesRestants -= 1;
  }

  return poids.map((p) => ({ id: p.id, montantCentimes: montantsParId.get(p.id) ?? 0 }));
}
