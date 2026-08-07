import { authenticatedFetch } from "../lib/authenticated-fetch";

export interface DocumentMetier {
  id: string;
  entiteType: "etat_des_lieux";
  entiteId: string;
  categorie: "photo";
  nomFichier: string;
}

// Réutilise le module Documents existant (aucun nouveau mécanisme de
// stockage) — même endpoint et même champ multipart "fichier" que
// apps/desktop/src/renderer/src/documents/api.ts. Bouton "+ Photo" par
// pièce (pas par élément) : une photo par appel, entiteId = l'état des
// lieux (pas la pièce, qui n'a pas d'identité propre côté documents).
export async function uploaderPhotoEtatDesLieux(
  etatDesLieuxId: string,
  fichier: File
): Promise<DocumentMetier> {
  const formData = new FormData();
  formData.append("fichier", fichier);
  formData.append("entiteType", "etat_des_lieux");
  formData.append("entiteId", etatDesLieuxId);
  formData.append("categorie", "photo");
  return authenticatedFetch<DocumentMetier>("/documents", { method: "POST", body: formData });
}
