export type TypeEntiteRecherchable = "sci" | "immeuble" | "appartement" | "locataire";

export interface EntiteRecherchable {
  type: TypeEntiteRecherchable;
  id: string;
  libelle: string;
  detail: string;
  texteRecherchable: string;
}

// Simple sous-chaîne insensible à la casse, priorité aux libellés qui
// commencent par la requête (ex. "dup" trouve "Dupont" avant "Jean Dupuis").
// Pas de logique floue/typo-tolerante : périmètre volontairement minimal
// pour ~20 logements, où une correspondance exacte suffit largement.
// Générique : réutilisé pour les entités nommées et pour les baux
// recherchables (étape 2 de "Nouveau paiement"), qui ne sont pas des
// EntiteRecherchable mais partagent la même forme minimale.
export function filtrerParTexte<T extends { texteRecherchable: string; libelle: string }>(
  items: T[],
  requete: string
): T[] {
  const q = requete.trim().toLowerCase();
  if (!q) {
    return [];
  }
  return items
    .filter((item) => item.texteRecherchable.includes(q))
    .sort((a, b) => {
      const prefixeA = a.texteRecherchable.startsWith(q) ? 0 : 1;
      const prefixeB = b.texteRecherchable.startsWith(q) ? 0 : 1;
      if (prefixeA !== prefixeB) {
        return prefixeA - prefixeB;
      }
      return a.libelle.localeCompare(b.libelle);
    })
    .slice(0, 8);
}

export function filtrerEntites(entites: EntiteRecherchable[], requete: string): EntiteRecherchable[] {
  return filtrerParTexte(entites, requete);
}

export const LIBELLES_TYPE: Record<TypeEntiteRecherchable, string> = {
  sci: "SCI",
  immeuble: "Immeuble",
  appartement: "Appartement",
  locataire: "Locataire"
};
