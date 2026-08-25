import { useState } from "react";
import { authenticatedFetchBlob } from "../lib/authenticated-fetch";

// Types nativement rendus par Chromium (moteur de rendu d'Electron) via une
// URL blob:, sans plugin ni permission supplémentaire — mêmes types que le
// lecteur PDF/image intégré du navigateur. Tout le reste (docx, xlsx...)
// reste en téléchargement classique (docs/backlog.md, checklist
// documentaire — aucune restriction de type n'existe à l'upload, ce repli
// est donc nécessaire, pas hypothétique).
const TYPES_PREVISUALISABLES = new Set(["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"]);

export interface ApercuDocument {
  blobUrl: string;
  mimeType: string;
  nomFichier: string;
}

function declencherTelechargement(blobUrl: string, nomFichier: string): void {
  const lien = document.createElement("a");
  lien.href = blobUrl;
  lien.download = nomFichier;
  lien.target = "_blank";
  lien.rel = "noopener noreferrer";
  document.body.appendChild(lien);
  lien.click();
  document.body.removeChild(lien);
}

// Remplace l'ancien ouvrirDocument (toujours un téléchargement forcé) :
// même point de déchiffrement (authenticatedFetchBlob, seul mécanisme
// autorisé — CLAUDE.md), mais bascule vers un aperçu inline (modale) pour
// les types nativement rendus, téléchargement classique sinon. L'URL blob:
// ne quitte jamais cette fenêtre (pas de nouvel onglet pour l'aperçu) et
// est révoquée à la fermeture.
export function useDocumentApercu(): {
  apercu: ApercuDocument | null;
  ouvrir: (id: string) => Promise<void>;
  fermer: () => void;
} {
  const [apercu, setApercu] = useState<ApercuDocument | null>(null);

  async function ouvrir(id: string): Promise<void> {
    const { blob, nomFichier } = await authenticatedFetchBlob(`/documents/${id}/contenu`);
    const blobUrl = URL.createObjectURL(blob);
    const nom = nomFichier ?? "document";
    if (TYPES_PREVISUALISABLES.has(blob.type)) {
      setApercu({ blobUrl, mimeType: blob.type, nomFichier: nom });
    } else {
      declencherTelechargement(blobUrl, nom);
      URL.revokeObjectURL(blobUrl);
    }
  }

  function fermer(): void {
    if (apercu) {
      URL.revokeObjectURL(apercu.blobUrl);
    }
    setApercu(null);
  }

  return { apercu, ouvrir, fermer };
}
