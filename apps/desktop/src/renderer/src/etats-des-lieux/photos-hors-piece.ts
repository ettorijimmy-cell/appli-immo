import type { DocumentMetier } from "../documents/api";

const PIECES_UNIQUES = new Set(["entree", "sejour", "cuisine"]);

// Numéros des pièces à occurrences multiples réellement affichées dans la
// vue (une carte par ligne existante ; pour les « autres pièces », seulement
// les emplacements encore configurés sur l'appartement).
export interface PiecesAffichees {
  chambre: number[];
  salle_de_bain: number[];
  wc: number[];
  autre: number[];
}

// Photos qu'aucune carte de pièce n'affiche : sans pièce, ou rattachées à
// une pièce absente de la vue. Elles sont montrées à part pour rester
// archivables depuis l'état des lieux (refus de la déclaration papier tant
// qu'une photo d'entrée reste active).
export function photosHorsPiece(photos: DocumentMetier[], affichees: PiecesAffichees): DocumentMetier[] {
  return photos.filter((photo) => {
    const type = photo.etatDesLieuxPieceType;
    const numero = photo.etatDesLieuxPieceNumero;
    if (!type) {
      return true;
    }
    if (PIECES_UNIQUES.has(type)) {
      return numero !== null;
    }
    const numeros = affichees[type as keyof PiecesAffichees];
    return numeros === undefined || numero === null || !numeros.includes(numero);
  });
}
