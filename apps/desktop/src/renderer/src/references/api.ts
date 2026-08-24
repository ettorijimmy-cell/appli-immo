import { authenticatedFetchBlob } from "../lib/authenticated-fetch";

// Fichier fixe, public, non rattaché à une entité (voir apps/backend/src/
// references) — même méthode de téléchargement que les autres documents
// générés (genererDocumentBail, locataires/api.ts).
export async function telechargerNoticeInformation(): Promise<void> {
  const { blob, nomFichier } = await authenticatedFetchBlob("/references/notice-information-bail");
  const url = URL.createObjectURL(blob);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nomFichier ?? "notice-information-bail.pdf";
  lien.target = "_blank";
  lien.rel = "noopener noreferrer";
  document.body.appendChild(lien);
  lien.click();
  document.body.removeChild(lien);
  URL.revokeObjectURL(url);
}
