import { Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { creerVerrouBasicAuth, lireConfigVerrouDepuisEnv, type ConfigVerrouBasicAuth } from "./mobile-web-basic-auth.middleware";

function requeteAvecAutorisation(
  utilisateur: string | undefined,
  motDePasse: string | undefined,
  ip = "203.0.113.7"
): Request {
  const authorization =
    utilisateur !== undefined && motDePasse !== undefined
      ? `Basic ${Buffer.from(`${utilisateur}:${motDePasse}`, "utf8").toString("base64")}`
      : undefined;
  return { headers: { authorization }, ip } as unknown as Request;
}

function creerResponseMock(): Response {
  const res = {
    statusCode: 0,
    status: vi.fn().mockImplementation((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis()
  };
  return res as unknown as Response;
}

const configBase: ConfigVerrouBasicAuth = { actif: true, utilisateur: "proprietaire", motDePasse: "secret-correct" };

describe("creerVerrouBasicAuth", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("identifiants corrects : appelle next(), aucune réponse écrite", () => {
    const middleware = creerVerrouBasicAuth(configBase);
    const req = requeteAvecAutorisation("proprietaire", "secret-correct");
    const res = creerResponseMock();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("en-tête Authorization absent : 401 + WWW-Authenticate, WARN avec l'IP sans les identifiants", () => {
    const middleware = creerVerrouBasicAuth(configBase);
    const req = { headers: {}, ip: "198.51.100.9" } as unknown as Request;
    const res = creerResponseMock();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith("WWW-Authenticate", expect.stringContaining("Basic"));
    expect(warnSpy).toHaveBeenCalledOnce();
    const messageWarn = warnSpy.mock.calls[0]?.[0] as string;
    expect(messageWarn).toContain("198.51.100.9");
    expect(messageWarn).not.toContain("proprietaire");
    expect(messageWarn).not.toContain("secret-correct");
  });

  it("mauvais mot de passe : 401 + WWW-Authenticate, identifiants tentés jamais journalisés", () => {
    const middleware = creerVerrouBasicAuth(configBase);
    const req = requeteAvecAutorisation("proprietaire", "mauvais-mot-de-passe");
    const res = creerResponseMock();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    const messageWarn = warnSpy.mock.calls[0]?.[0] as string;
    expect(messageWarn).not.toContain("mauvais-mot-de-passe");
  });

  it("mauvais utilisateur : 401, même avec le bon mot de passe", () => {
    const middleware = creerVerrouBasicAuth(configBase);
    const req = requeteAvecAutorisation("quelqu-un-d-autre", "secret-correct");
    const res = creerResponseMock();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("en-tête malformé (pas de ':' décodé) : traité comme absent, 401", () => {
    const middleware = creerVerrouBasicAuth(configBase);
    const req = {
      headers: { authorization: `Basic ${Buffer.from("sans-separateur", "utf8").toString("base64")}` },
      ip: "203.0.113.7"
    } as unknown as Request;
    const res = creerResponseMock();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("schéma autre que Basic : traité comme absent, 401", () => {
    const middleware = creerVerrouBasicAuth(configBase);
    const req = { headers: { authorization: "Bearer un-jwt" }, ip: "203.0.113.7" } as unknown as Request;
    const res = creerResponseMock();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("mot de passe contenant ':' : scindé sur le premier ':' seulement, comparaison correcte", () => {
    const config: ConfigVerrouBasicAuth = { actif: true, utilisateur: "proprietaire", motDePasse: "mot:de:passe" };
    const middleware = creerVerrouBasicAuth(config);
    const req = requeteAvecAutorisation("proprietaire", "mot:de:passe");
    const res = creerResponseMock();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("verrou désactivé (actif=false) : next() sans aucune vérification, même sans en-tête", () => {
    const middleware = creerVerrouBasicAuth({ actif: false, utilisateur: undefined, motDePasse: undefined });
    const req = { headers: {}, ip: "203.0.113.7" } as unknown as Request;
    const res = creerResponseMock();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("configuration incomplète (mot de passe manquant) : 503, jamais une exception, API non affectée", () => {
    const middleware = creerVerrouBasicAuth({ actif: true, utilisateur: "proprietaire", motDePasse: undefined });
    const req = requeteAvecAutorisation("proprietaire", "peu-importe");
    const res = creerResponseMock();
    const next = vi.fn();

    expect(() => middleware(req, res, next)).not.toThrow();
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it("configuration incomplète (utilisateur manquant) : 503", () => {
    const middleware = creerVerrouBasicAuth({ actif: true, utilisateur: undefined, motDePasse: "secret" });
    const req = requeteAvecAutorisation("peu-importe", "secret");
    const res = creerResponseMock();
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
  });
});

describe("lireConfigVerrouDepuisEnv", () => {
  it("actif par défaut quand la variable est absente", () => {
    expect(lireConfigVerrouDepuisEnv({}).actif).toBe(true);
  });

  it("MOBILE_WEB_BASIC_AUTH_ENABLED=false désactive le verrou", () => {
    expect(lireConfigVerrouDepuisEnv({ MOBILE_WEB_BASIC_AUTH_ENABLED: "false" }).actif).toBe(false);
  });

  it("toute autre valeur que la chaîne 'false' laisse le verrou actif", () => {
    expect(lireConfigVerrouDepuisEnv({ MOBILE_WEB_BASIC_AUTH_ENABLED: "0" }).actif).toBe(true);
  });

  it("lit l'utilisateur et le mot de passe depuis l'environnement", () => {
    const config = lireConfigVerrouDepuisEnv({
      MOBILE_WEB_BASIC_AUTH_USER: "jimmy",
      MOBILE_WEB_BASIC_AUTH_PASSWORD: "un-secret"
    });
    expect(config.utilisateur).toBe("jimmy");
    expect(config.motDePasse).toBe("un-secret");
  });
});
