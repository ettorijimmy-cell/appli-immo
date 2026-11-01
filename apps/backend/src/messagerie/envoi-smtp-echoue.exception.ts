import { BadGatewayException } from "@nestjs/common";
import type { NodemailerError } from "nodemailer";

export type CategorieEchecSmtp = "authentification" | "reseau" | "rejet" | "autre";

const MESSAGES: Record<CategorieEchecSmtp, string> = {
  authentification: "La boîte mail a refusé la connexion. Vérifiez son mot de passe d'application.",
  reseau: "Le serveur de messagerie est injoignable. Réessayez dans quelques minutes.",
  rejet: "Le serveur de messagerie a refusé ce message ou cette adresse.",
  autre: "L'envoi a échoué. Réessayez dans quelques minutes."
};

const CODES_AUTHENTIFICATION = new Set(["EAUTH", "ENOAUTH"]);
const CODES_RESEAU = new Set(["ETIMEDOUT", "ECONNECTION", "ESOCKET", "EDNS", "ETLS"]);
const CODES_REJET = new Set(["EENVELOPE", "EMESSAGE"]);

export function categoriserEchecSmtp(erreur: unknown): CategorieEchecSmtp {
  const { code } = (erreur ?? {}) as Partial<NodemailerError>;
  if (code && CODES_AUTHENTIFICATION.has(code)) {
    return "authentification";
  }
  if (code && CODES_RESEAU.has(code)) {
    return "reseau";
  }
  if (code && CODES_REJET.has(code)) {
    return "rejet";
  }
  return "autre";
}

// Hérite de BadGatewayException (502) pour rester compatible avec les
// appelants existants. Le texte renvoyé au client est toujours l'un des
// messages français ci-dessus, jamais la réponse brute du serveur SMTP, qui
// peut reprendre l'adresse de la boîte.
export class EnvoiSmtpEchoueException extends BadGatewayException {
  readonly categorie: CategorieEchecSmtp;
  readonly codeTechnique: string | null;
  readonly codeSmtp: number | null;

  constructor(erreur: unknown) {
    const categorie = categoriserEchecSmtp(erreur);
    super({ message: MESSAGES[categorie], code: `SMTP_${categorie.toUpperCase()}` });
    const { code, responseCode } = (erreur ?? {}) as Partial<NodemailerError>;
    this.categorie = categorie;
    this.codeTechnique = code ?? null;
    this.codeSmtp = typeof responseCode === "number" ? responseCode : null;
  }
}
