import { authenticatedFetch } from "../lib/authenticated-fetch";

// Correspond exactement aux étapes "piece-*" du parcours pas-à-pas
// (stepper-config.ts), sans le préfixe "piece-".
export type EtatDesLieuxPieceType = "entree" | "sejour" | "cuisine" | "chambre" | "salle_de_bain" | "wc" | "autre";

export interface DocumentMetier {
  id: string;
  entiteType: "etat_des_lieux";
  entiteId: string;
  categorie: "photo";
  nomFichier: string;
  etatDesLieuxPieceType: EtatDesLieuxPieceType | null;
  etatDesLieuxPieceNumero: number | null;
}

// Réutilise le module Documents existant (aucun nouveau mécanisme de
// stockage) — même endpoint et même champ multipart "fichier" que
// apps/desktop/src/renderer/src/documents/api.ts. Bouton "+ Photo" par
// pièce (pas par élément) : une photo par appel, entiteId = l'état des
// lieux (le header, seul id garanti d'exister au moment de la prise — la
// ligne de pièce précise peut ne pas encore être créée, upsert-by-id à la
// soumission de l'étape seulement). pieceType/pieceNumero rattachent
// précisément la photo à sa pièce pour la vue de relecture desktop, sans
// dépendre de cette ligne — voir docs/error-log.md, [2026-08-07] Photos
// état des lieux non rattachées aux pièces.
export async function uploaderPhotoEtatDesLieux(
  etatDesLieuxId: string,
  fichier: File,
  pieceType: EtatDesLieuxPieceType,
  pieceNumero?: number
): Promise<DocumentMetier> {
  const formData = new FormData();
  formData.append("fichier", fichier);
  formData.append("entiteType", "etat_des_lieux");
  formData.append("entiteId", etatDesLieuxId);
  formData.append("categorie", "photo");
  formData.append("etatDesLieuxPieceType", pieceType);
  if (pieceNumero !== undefined) {
    formData.append("etatDesLieuxPieceNumero", String(pieceNumero));
  }
  return authenticatedFetch<DocumentMetier>("/documents", { method: "POST", body: formData });
}
