import { usePieceApercu, type ApercuFichier } from "../lib/use-piece-apercu";

// Même mécanisme que use-document-apercu.ts (Module Documents) — seul le
// chemin change : le PDF figé de l'état des lieux a son propre endpoint de
// contenu déchiffré (EtatDesLieuxPdfController.telecharger), distinct du
// point d'accès générique /documents/:id/contenu. `ouvrir` prend la phase
// ("entree"/"sortie"), pas un documentId — le contrôleur la résout lui-même.
export function useEtatDesLieuxPdfApercu(etatDesLieuxId: string): {
  apercu: ApercuFichier | null;
  erreur: string | null;
  ouvrir: (phase: "entree" | "sortie") => Promise<void>;
  fermer: () => void;
} {
  return usePieceApercu((phase) => `/etats-des-lieux/${etatDesLieuxId}/pdf/${phase}/contenu`);
}
