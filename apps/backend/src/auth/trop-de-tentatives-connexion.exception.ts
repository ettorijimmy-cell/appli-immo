import { HttpException, HttpStatus } from "@nestjs/common";

// Statut 429, délai conservé sur l'exception elle-même (pas seulement
// dans le corps JSON) : TropDeTentativesConnexionFilter en a besoin pour
// poser l'en-tête Retry-After (RFC 9110 §10.2.3) avant d'envoyer la
// réponse — un en-tête que NestJS ne pose jamais tout seul depuis le
// corps d'une HttpException.
export class TropDeTentativesConnexionException extends HttpException {
  constructor(public readonly retryAfterSeconds: number) {
    super(
      {
        message: "Trop de tentatives de connexion. Réessayez plus tard.",
        retryAfterSeconds
      },
      HttpStatus.TOO_MANY_REQUESTS
    );
  }
}
