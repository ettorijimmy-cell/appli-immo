// Relation 1:1 stricte (un seul justificatif par remboursement, docs/backlog.md)
// : nom de fichier fixe dans le dossier du remboursement, contrairement à
// documents/<entiteType>/<entiteId>/<documentId>.enc où documentId varie à
// chaque upload/version. Seul l'UUID du remboursement apparaît dans le
// chemin — jamais le nom de fichier original, qui reste uniquement en base
// (piece_justificative_nom_fichier), même principe que construireCheminStockage.
export function construireCheminPieceJustificative(remboursementId: string): string {
  return `remboursements/${remboursementId}/piece-justificative.enc`;
}
