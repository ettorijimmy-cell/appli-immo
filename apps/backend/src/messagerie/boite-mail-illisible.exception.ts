import { HttpException, HttpStatus } from "@nestjs/common";

// Mot de passe de la boîte présent mais indéchiffrable avec la clé active,
// typiquement écrit par un autre environnement. Seule issue : le saisir à
// nouveau depuis Paramètres, même traitement côté client que
// BoiteMailNonConfigureeException.
export class BoiteMailIllisibleException extends HttpException {
  constructor() {
    super(
      {
        message: "Le mot de passe de la boîte mail n'est plus lisible. Saisissez-le à nouveau dans Paramètres.",
        code: "BOITE_MAIL_ILLISIBLE"
      },
      HttpStatus.CONFLICT
    );
  }
}
