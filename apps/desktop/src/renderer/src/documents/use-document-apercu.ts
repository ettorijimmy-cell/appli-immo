import { usePieceApercu, type ApercuFichier } from "../lib/use-piece-apercu";

export type ApercuDocument = ApercuFichier;

// Remplace l'ancien ouvrirDocument (toujours un téléchargement forcé) :
// même point de déchiffrement (authenticatedFetchBlob, seul mécanisme
// autorisé — CLAUDE.md), mais bascule vers un aperçu inline (modale) pour
// les types nativement rendus, téléchargement classique sinon. Logique
// commune extraite dans usePieceApercu (Module Messagerie, 2026-09-16),
// réutilisée pour les pièces jointes de messages.
export function useDocumentApercu(): {
  apercu: ApercuDocument | null;
  erreur: string | null;
  ouvrir: (id: string) => Promise<void>;
  fermer: () => void;
} {
  return usePieceApercu((id) => `/documents/${id}/contenu`);
}
