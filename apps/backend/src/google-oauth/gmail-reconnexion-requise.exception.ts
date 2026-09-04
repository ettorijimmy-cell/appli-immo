import { HttpException, HttpStatus } from "@nestjs/common";

// Distincte d'une erreur générique : le frontend doit pouvoir orienter
// l'utilisateur vers "Reconnecter Gmail" plutôt qu'afficher un message
// d'erreur opaque. `code` (pas seulement le statut HTTP) permet au
// frontend de distinguer ce cas précis sans dépendre du texte du message.
export class GmailReconnexionRequiseException extends HttpException {
  constructor(message: string) {
    super({ message, code: "GMAIL_RECONNEXION_REQUISE" }, HttpStatus.CONFLICT);
  }
}
