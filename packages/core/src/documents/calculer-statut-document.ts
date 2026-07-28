export type StatutDocument = "valide" | "expire" | "archive";

/**
 * Règle de gestion (docs/backlog.md, Module 4) : le statut d'un document
 * n'est jamais saisi directement pour les valeurs `valide`/`expire` —
 * calculé à la lecture depuis `date_expiration` comparée à la date de
 * référence (comparaison lexicographique sur des dates ISO, jamais via
 * `Date` natif — évite toute dépendance au fuseau horaire de la machine).
 * `archive` prime toujours sur le calcul : un document archivé ne redevient
 * jamais `expire` automatiquement.
 *
 * Le jour de `date_expiration` lui-même est encore valide (expiration en
 * fin de journée, pas à minuit) : le document devient `expire` seulement à
 * partir du lendemain.
 *
 * Fonction volontairement pure et sans effet de bord : tant que le job
 * planifié du Module 6 n'existe pas, `documents.statut` n'est jamais
 * réécrit en base pour `expire` — seule la valeur retournée par l'API la
 * reflète (docs/data-dictionary.md, section documents). Le Module 6
 * réutilisera cette même fonction telle quelle pour son job quotidien.
 */
export function calculerStatutDocument(
  dateExpiration: string | null,
  archive: boolean,
  dateReference: string
): StatutDocument {
  if (archive) {
    return "archive";
  }
  if (dateExpiration !== null && dateExpiration < dateReference) {
    return "expire";
  }
  return "valide";
}
