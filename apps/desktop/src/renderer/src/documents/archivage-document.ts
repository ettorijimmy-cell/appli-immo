import { messageErreurApi } from "../lib/message-erreur-api";
import type { DocumentMetier } from "./api";

// Archivage d'un document (statut + archived_at, jamais une suppression).
// Une photo demande toujours une confirmation : depuis l'état des lieux
// (sous les miniatures) comme depuis l'écran Documents.
export const MESSAGE_CONFIRMATION_ARCHIVAGE_PHOTO =
  "La photo sera archivée, pas supprimée. Elle reste consultable dans les archives.";

export function confirmationArchivageRequise(document: Pick<DocumentMetier, "categorie">): boolean {
  return document.categorie === "photo";
}

// Repli propre à l'objet, quand le backend ne renvoie pas de message
// exploitable (réseau, générique NestJS).
export function messageRepliArchivage(document: Pick<DocumentMetier, "categorie">): string {
  return document.categorie === "photo" ? "Impossible d'archiver cette photo." : "Impossible d'archiver ce document.";
}

// Message du backend quand il est exploitable (refus du verrou de
// signature, document introuvable...), sinon le repli propre à l'objet.
export function messageErreurArchivage(erreur: unknown, document: Pick<DocumentMetier, "categorie">): string {
  return messageErreurApi(erreur, messageRepliArchivage(document));
}
