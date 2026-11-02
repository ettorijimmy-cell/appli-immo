export const MENTION_PIECE_AJOUTEE = "Pièce ajoutée après l'état des lieux d'entrée";

// Une pièce absente à l'entrée reste ajoutable jusqu'à la signature de sortie,
// avec son seul libellé et ses champs de sortie (voir submitPieceAutre).
export function affichagePieceAutre(row: unknown | null, sortieSignee: boolean): "carte" | "ajouter" | "rien" {
  if (row) {
    return "carte";
  }
  return sortieSignee ? "rien" : "ajouter";
}
