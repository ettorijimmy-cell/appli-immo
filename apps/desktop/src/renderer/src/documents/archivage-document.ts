import type { DocumentMetier } from "./api";

// Archivage d'un document (statut + archived_at, jamais une suppression).
// Tout archivage de document passe par une confirmation, photo comprise :
// fiches et écran Documents (texteArchivageDocument, lib/textes-
// confirmation.ts), état des lieux (ConfirmationArchivagePhotoModal).
export const MESSAGE_CONFIRMATION_ARCHIVAGE_PHOTO =
  "La photo sera archivée, pas supprimée. Elle reste consultable dans les archives. L'archivage ne peut pas être annulé depuis l'application.";

// Repli propre à l'objet, quand le backend ne renvoie pas de message
// exploitable (réseau, générique NestJS) — voir messageErreurApi.
export function messageRepliArchivage(document: Pick<DocumentMetier, "categorie">): string {
  return document.categorie === "photo" ? "Impossible d'archiver cette photo." : "Impossible d'archiver ce document.";
}
