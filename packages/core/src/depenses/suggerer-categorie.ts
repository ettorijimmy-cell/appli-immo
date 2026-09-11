import { libelleContient } from "../texte/normaliser-texte";

export interface RegleCategorisationPourSuggestion {
  motCle: string;
  categorie: string;
}

/**
 * Suggère une catégorie de dépense à partir du libellé d'une ligne de
 * relevé CSV et des règles mot-clé -> catégorie déjà chargées pour
 * l'organisation courante (packages/db, table regle_categorisation) —
 * fonction pure, aucun accès base (les règles sont passées en paramètre).
 *
 * Retourne la catégorie SEULEMENT si EXACTEMENT une règle correspond au
 * libellé (correspondance insensible à la casse/aux accents/à la
 * ponctuation, voir libelleContient) — zéro ou plusieurs correspondances
 * renvoient null : jamais de choix arbitraire entre deux règles
 * candidates (décision produit, Module Charges et fiscalité, Étape 2).
 *
 * Cette suggestion ne fait QUE présélectionner une catégorie dans le
 * formulaire déjà existant (ImportCsvDepensesView) — jamais une
 * catégorisation automatique sans confirmation humaine, aucun changement
 * à ce principe.
 */
export function suggererCategorie(libelle: string, regles: RegleCategorisationPourSuggestion[]): string | null {
  const correspondances = regles.filter((regle) => libelleContient(libelle, regle.motCle));
  if (correspondances.length !== 1) {
    return null;
  }
  return correspondances[0]!.categorie;
}
