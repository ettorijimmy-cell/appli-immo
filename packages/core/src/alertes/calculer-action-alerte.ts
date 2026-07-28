export type StatutAlerteExistant = "active" | "traitee" | "ignoree" | "resolue" | null;

export type ActionAlerte =
  | { action: "aucune" }
  | { action: "creer" }
  | { action: "fermer" }
  | { action: "rouvrir" }
  | { action: "maj_condition"; conditionVraie: boolean };

/**
 * Cœur du cycle de vie d'une alerte (docs/data-dictionary.md, section
 * alertes) : décide, sans aucun accès base, quelle action appliquer à
 * partir de l'état de la dernière ligne connue pour un (type, entiteId) et
 * de la condition de déclenchement recalculée aujourd'hui. Fonction pure,
 * réutilisée par `AlertesJobService.synchroniserAlerte` (apps/backend) qui
 * se contente d'exécuter l'action retournée.
 *
 * - Aucune alerte existante (`statutActuel = null`) : crée si la condition
 *   est vraie, sinon rien.
 * - `active` : ferme (`resolue`) si la condition devient fausse ; sinon met
 *   simplement à jour le suivi interne si besoin.
 * - `resolue` : se rouvre EN PLACE si la condition redevient vraie.
 * - `traitee` / `ignoree` : décision humaine définitive pour cette
 *   occurrence, jamais réécrite. Une nouvelle occurrence (`creer`) n'est
 *   déclenchée que sur une vraie transition faux→vrai de
 *   `derniereConditionVraie` — jamais simplement parce que la condition
 *   est encore vraie aujourd'hui (sinon une alerte déjà traitée dont la
 *   condition reste vraie indéfiniment par construction, comme
 *   bail_fin_proche, se dupliquerait chaque jour).
 */
export function calculerActionAlerte(
  statutActuel: StatutAlerteExistant,
  derniereConditionVraie: boolean,
  conditionActuelle: boolean
): ActionAlerte {
  if (statutActuel === null) {
    return conditionActuelle ? { action: "creer" } : { action: "aucune" };
  }

  if (statutActuel === "active") {
    if (derniereConditionVraie === conditionActuelle) {
      return { action: "aucune" };
    }
    return conditionActuelle ? { action: "maj_condition", conditionVraie: true } : { action: "fermer" };
  }

  if (statutActuel === "resolue") {
    if (conditionActuelle) {
      return { action: "rouvrir" };
    }
    return derniereConditionVraie ? { action: "maj_condition", conditionVraie: false } : { action: "aucune" };
  }

  // traitee / ignoree : le statut ne bouge jamais.
  if (conditionActuelle && !derniereConditionVraie) {
    return { action: "creer" };
  }
  if (derniereConditionVraie !== conditionActuelle) {
    return { action: "maj_condition", conditionVraie: conditionActuelle };
  }
  return { action: "aucune" };
}
