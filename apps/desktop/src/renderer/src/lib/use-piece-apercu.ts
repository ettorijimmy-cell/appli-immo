import { useState } from "react";
import { authenticatedFetchBlob } from "./authenticated-fetch";

// Types nativement rendus par Chromium (moteur de rendu d'Electron) via une
// URL blob:, sans plugin ni permission supplémentaire — mêmes types que le
// lecteur PDF/image intégré du navigateur. Tout le reste (docx, xlsx...)
// reste en téléchargement classique.
const TYPES_PREVISUALISABLES = new Set(["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"]);

export interface ApercuFichier {
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

// Extrait de documents/use-document-apercu.ts (Module Messagerie, 2026-09-16) :
// même mécanisme d'aperçu (documents et pièces jointes de messages ont
// chacun leur propre endpoint de contenu déchiffré, seul le chemin change)
// — factorisé ici pour éviter de dupliquer la logique blob:/téléchargement
// une deuxième fois. Le seul point de déchiffrement reste
// authenticatedFetchBlob (CLAUDE.md) ; l'URL blob: ne quitte jamais cette
// fenêtre et est révoquée à la fermeture.
export function usePieceApercu(cheminContenu: (id: string) => string): {
  apercu: ApercuFichier | null;
  ouvrir: (id: string) => Promise<void>;
  fermer: () => void;
} {
  const [apercu, setApercu] = useState<ApercuFichier | null>(null);

  async function ouvrir(id: string): Promise<void> {
    const { blob, nomFichier } = await authenticatedFetchBlob(cheminContenu(id));
    const blobUrl = URL.createObjectURL(blob);
    const nom = nomFichier ?? "fichier";
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
