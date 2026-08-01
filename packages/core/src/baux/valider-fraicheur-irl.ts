import { ajouterMois } from "../dates/calendrier";

// L'IRL est publié trimestriellement (mi-janvier/avril/juillet/octobre) —
// un écart de plus de 4 mois depuis la dernière récupération signale un
// problème de rafraîchissement de la tâche planifiée, pas une absence
// légitime de nouvelle publication (docs/backlog.md, section "Édition
// d'un bail").
const SEUIL_PEREMPTION_MOIS = 4;

/**
 * Détermine si la dernière valeur IRL connue est trop ancienne pour être
 * utilisée dans un document généré. `dateRecuperation`/`dateReference` au
 * format ISO (YYYY-MM-DD) — un timestamp complet doit être tronqué par
 * l'appelant.
 */
export function irlEstPerime(dateRecuperation: string, dateReference: string): boolean {
  const seuil = ajouterMois(dateRecuperation, SEUIL_PEREMPTION_MOIS);
  return dateReference > seuil;
}
