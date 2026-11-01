import { BadGatewayException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { categoriserEchecSmtp, EnvoiSmtpEchoueException } from "./envoi-smtp-echoue.exception";

function erreurSmtp(code: string, responseCode?: number): Error {
  return Object.assign(new Error(`Réponse serveur pour boite-dediee@example.com (${code})`), { code, responseCode });
}

describe("categoriserEchecSmtp", () => {
  it.each([
    ["EAUTH", "authentification"],
    ["ENOAUTH", "authentification"],
    ["ETIMEDOUT", "reseau"],
    ["ECONNECTION", "reseau"],
    ["ESOCKET", "reseau"],
    ["EDNS", "reseau"],
    ["ETLS", "reseau"],
    ["EENVELOPE", "rejet"],
    ["EMESSAGE", "rejet"],
    ["EPROTOCOL", "autre"]
  ])("%s → %s", (code, categorie) => {
    expect(categoriserEchecSmtp(erreurSmtp(code))).toBe(categorie);
  });

  it("une erreur sans code reste 'autre'", () => {
    expect(categoriserEchecSmtp(new Error("inconnue"))).toBe("autre");
    expect(categoriserEchecSmtp(undefined)).toBe("autre");
  });
});

describe("EnvoiSmtpEchoueException", () => {
  it("reste une BadGatewayException, avec message français et code typé", () => {
    const exception = new EnvoiSmtpEchoueException(erreurSmtp("EAUTH", 535));

    expect(exception).toBeInstanceOf(BadGatewayException);
    expect(exception.getStatus()).toBe(502);
    expect(exception.getResponse()).toEqual({
      message: "La boîte mail a refusé la connexion. Vérifiez son mot de passe d'application.",
      code: "SMTP_AUTHENTIFICATION"
    });
    expect(exception.categorie).toBe("authentification");
    expect(exception.codeTechnique).toBe("EAUTH");
    expect(exception.codeSmtp).toBe(535);
  });

  it("n'expose jamais le texte du serveur au client", () => {
    const exception = new EnvoiSmtpEchoueException(erreurSmtp("ETIMEDOUT"));

    expect(JSON.stringify(exception.getResponse())).not.toContain("boite-dediee@example.com");
  });

  it("sans code technique ni code SMTP : valeurs nulles", () => {
    const exception = new EnvoiSmtpEchoueException(new Error("inconnue"));

    expect(exception.codeTechnique).toBeNull();
    expect(exception.codeSmtp).toBeNull();
  });
});
