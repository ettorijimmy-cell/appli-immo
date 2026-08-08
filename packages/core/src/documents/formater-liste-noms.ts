/**
 * Énumération française standard pour une liste de noms (locataires d'un
 * bail en colocation) : virgule entre tous les noms sauf le dernier, "et"
 * uniquement avant le dernier — jamais "et" répété entre chaque nom.
 * Utilisé par les documents générés (bail, état des lieux) partout où
 * plusieurs locataires doivent apparaître sur une seule ligne.
 */
export function formaterListeNoms(noms: string[]): string {
  if (noms.length === 0) {
    return "";
  }
  if (noms.length === 1) {
    return noms[0]!;
  }
  return `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}`;
}
