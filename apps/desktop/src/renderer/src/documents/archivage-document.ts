import { messageErreurCartePdf } from "../etats-des-lieux/message-erreur-carte-pdf";
import type { DocumentMetier } from "./api";

// Archivage d'un document (statut + archived_at, jamais une suppression).
// Une photo demande toujours une confirmation : depuis l'état des lieux
// (sous les miniatures) comme depuis l'écran Documents.
export const MESSAGE_CONFIRMATION_ARCHIVAGE_PHOTO =
  "La photo sera archivée, pas supprimée. Elle reste consultable dans les archives.";

export function confirmationArchivageRequise(document: Pick<DocumentMetier, "categorie">): boolean {
  return document.categorie === "photo";
}

// Message du backend quand il est exploitable (refus du verrou de
// signature, document introuvable...), sinon un repli propre à l'objet.
export function messageErreurArchivage(erreur: unknown, document: Pick<DocumentMetier, "categorie">): string {
  return messageErreurCartePdf(
    erreur,
    document.categorie === "photo" ? "Impossible d'archiver cette photo." : "Impossible d'archiver ce document."
  );
}
