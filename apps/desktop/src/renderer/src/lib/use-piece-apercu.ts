import { useState } from "react";
import { authenticatedFetchBlob } from "./authenticated-fetch";

// Types nativement rendus par Chromium (moteur de rendu d'Electron) via une
// URL blob:, sans plugin ni permission supplémentaire — mêmes types que le
// lecteur PDF/image intégré du navigateur. Tout le reste (xlsx...) reste en
// téléchargement classique, sauf .docx (voir MIME_DOCX ci-dessous).
const TYPES_PREVISUALISABLES = new Set(["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"]);

// Même constante que côté backend (bail-document-docx.controller.ts et les
// deux autres générateurs ; pour un .docx uploadé dans le module Documents,
// c'est document.mimeType qui est renvoyé, fixé par le navigateur/OS au
// moment de la sélection du fichier — la même valeur standard). Un .docx
// n'est jamais prévisualisable inline (pas de moteur de rendu docx dans
// Chromium) mais ne doit plus non plus forcer un téléchargement navigateur :
// ouvert directement avec l'application par défaut du système via le canal
// IPC documents:ouvrirTemporaire. S'applique aussi bien aux documents du
// module Documents qu'aux pièces jointes de la Messagerie — même hook
// partagé, comportement volontairement identique quelle que soit l'origine
// de l'appel.
const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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
  erreur: string | null;
  ouvrir: (id: string) => Promise<void>;
  fermer: () => void;
} {
  const [apercu, setApercu] = useState<ApercuFichier | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  // Sans ce try/catch, un échec (fetch, ou canal IPC documents:
  // ouvrirTemporaire si aucune application n'est associée à .docx sur le
  // système) restait une promesse rejetée silencieuse — tous les appelants
  // invoquent ouvrir() en fire-and-forget (void ouvrir(id), ou passé
  // directement en callback à un composant enfant). Même discipline que
  // PatrimoinePage.tsx (bandeau role="alert" plutôt qu'un échec muet).
  async function ouvrir(id: string): Promise<void> {
    setErreur(null);
    try {
      const { blob, nomFichier } = await authenticatedFetchBlob(cheminContenu(id));
      const nom = nomFichier ?? "fichier";
      if (TYPES_PREVISUALISABLES.has(blob.type)) {
        setApercu({ blobUrl: URL.createObjectURL(blob), mimeType: blob.type, nomFichier: nom });
      } else if (blob.type === MIME_DOCX) {
        // Filet de sécurité : le nom réel vient normalement du header
        // Content-Disposition (voir main.ts, exposedHeaders) — mais si
        // jamais il manque, "fichier" seul ferait échouer la validation
        // d'extension du canal IPC (documents-temp.ts,
        // validerNomFichierDocx) alors que le contenu est bien un .docx.
        const nomDocx = nom.toLowerCase().endsWith(".docx") ? nom : `${nom}.docx`;
        await window.api.documents.ouvrirTemporaire(await blob.arrayBuffer(), nomDocx);
      } else {
        const blobUrl = URL.createObjectURL(blob);
        declencherTelechargement(blobUrl, nom);
        URL.revokeObjectURL(blobUrl);
      }
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Impossible d'ouvrir le fichier");
    }
  }

  function fermer(): void {
    if (apercu) {
      URL.revokeObjectURL(apercu.blobUrl);
    }
    setApercu(null);
  }

  return { apercu, erreur, ouvrir, fermer };
}
