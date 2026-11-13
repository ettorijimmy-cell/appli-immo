// Filtrage des éléments archivés d'une liste (archivedAt rempli) : masqués
// par défaut, réaffichés avec « Afficher les archivés » (ArchiveToggle,
// components/ArchiveFilter.tsx) — même règle sur toutes les listes.
export function lignesVisibles<T extends { archivedAt: string | null }>(
  lignes: readonly T[],
  afficherArchives: boolean
): T[] {
  return afficherArchives ? [...lignes] : lignes.filter((ligne) => ligne.archivedAt === null);
}

// Un élément ouvert en édition n'est plus archivable s'il l'est déjà
// (archivedAt serait sinon réécrit, voir tmp/decisions-archivage.md point 8).
export function estArchive(ligne: { archivedAt: string | null } | undefined): boolean {
  return ligne !== undefined && ligne.archivedAt !== null;
}
