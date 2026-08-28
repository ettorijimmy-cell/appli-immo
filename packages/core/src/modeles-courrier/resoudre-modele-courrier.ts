export interface ModeleCourrierAResoudre {
  objet: string | null;
  corps: string;
}

export interface ModeleCourrierResolu {
  objet: string | null;
  corps: string;
}

const REGEX_VARIABLE = /\{\{(\w+)\}\}/g;

function resoudreTexte(texte: string, variables: Record<string, string>, manquantes: Set<string>): string {
  return texte.replace(REGEX_VARIABLE, (correspondance, cle: string) => {
    if (!(cle in variables)) {
      manquantes.add(cle);
      return correspondance;
    }
    return variables[cle]!;
  });
}

/**
 * Remplace chaque occurrence de `{{cle}}` dans `objet`/`corps` par
 * `variables[cle]`. Jamais de substitution silencieuse : si une clé du
 * modèle n'a pas de valeur fournie, lève une erreur listant toutes les
 * variables manquantes (corps ET objet) plutôt que de laisser un `{{cle}}`
 * littéral dans le résultat.
 */
export function resoudreModeleCourrier(
  modele: ModeleCourrierAResoudre,
  variables: Record<string, string>
): ModeleCourrierResolu {
  const manquantes = new Set<string>();

  const corps = resoudreTexte(modele.corps, variables, manquantes);
  const objet = modele.objet !== null ? resoudreTexte(modele.objet, variables, manquantes) : null;

  if (manquantes.size > 0) {
    throw new Error(
      `Variable(s) manquante(s) pour la résolution du modèle de courrier : ${[...manquantes].join(", ")}`
    );
  }

  return { objet, corps };
}
