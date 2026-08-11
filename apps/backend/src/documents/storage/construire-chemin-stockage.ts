import type { DocumentEntiteType } from "../dto/create-document.dto";

// Organisation du stockage (bucket Scaleway Object Storage ou dossier local
// DOCUMENTS_STORAGE_DIR selon DocumentStorageService) par entité plutôt
// qu'un préfixe plat : documents/<entiteType>/<entiteId>/<documentId>.enc.
// Seuls des UUID apparaissent dans le chemin — jamais le nom de fichier
// original (documents.nom_fichier), qui reste uniquement en base (voir
// docs/data-dictionary.md, section documents).
export function construireCheminStockage(
  entiteType: DocumentEntiteType,
  entiteId: string,
  documentId: string
): string {
  return `documents/${entiteType}/${entiteId}/${documentId}.enc`;
}
