import { usePieceApercu, type ApercuFichier } from "../lib/use-piece-apercu";

export type ApercuPieceJointe = ApercuFichier;

export function useMessagerieApercu(): {
  apercu: ApercuPieceJointe | null;
  ouvrir: (id: string) => Promise<void>;
  fermer: () => void;
} {
  return usePieceApercu((id) => `/messagerie/pieces-jointes/${id}/contenu`);
}
