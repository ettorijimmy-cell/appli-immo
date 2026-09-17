import { HttpException, HttpStatus } from "@nestjs/common";

// Distincte d'une erreur générique : le frontend doit pouvoir orienter
// l'utilisateur vers "Configurer la boîte mail dédiée" dans Paramètres
// plutôt qu'afficher un message d'erreur opaque — même principe que
// GmailReconnexionRequiseException (google-oauth/).
export class BoiteMailNonConfigureeException extends HttpException {
  constructor(message: string) {
    super({ message, code: "BOITE_MAIL_NON_CONFIGUREE" }, HttpStatus.CONFLICT);
  }
}
