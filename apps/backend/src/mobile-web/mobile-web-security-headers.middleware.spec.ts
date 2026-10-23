import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { creerEntetesSecurite } from "./mobile-web-security-headers.middleware";

function creerResponseMock(): Response {
  const res = { setHeader: vi.fn().mockReturnThis() };
  return res as unknown as Response;
}

describe("creerEntetesSecurite", () => {
  let dossierTemp: string;

  beforeEach(() => {
    dossierTemp = mkdtempSync(join(tmpdir(), "mobile-web-entetes-"));
  });

  afterEach(() => {
    rmSync(dossierTemp, { recursive: true, force: true });
  });

  it("pose X-Content-Type-Options sans condition, et la CSP extraite d'index.html, puis appelle next()", () => {
    const cheminIndex = join(dossierTemp, "index.html");
    writeFileSync(
      cheminIndex,
      `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self'" /></head></html>`
    );

    const middleware = creerEntetesSecurite(cheminIndex);
    const res = creerResponseMock();
    const next = vi.fn();

    middleware({} as Request, res, next);

    expect(res.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Security-Policy",
      "default-src 'self'; connect-src 'self'"
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it("index.html absent : X-Content-Type-Options posé quand même, pas de CSP, jamais une exception", () => {
    const middleware = creerEntetesSecurite(join(dossierTemp, "index-inexistant.html"));
    const res = creerResponseMock();
    const next = vi.fn();

    expect(() => middleware({} as Request, res, next)).not.toThrow();
    expect(res.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(res.setHeader).not.toHaveBeenCalledWith("Content-Security-Policy", expect.anything());
    expect(next).toHaveBeenCalledOnce();
  });

  it("balise CSP absente du fichier : X-Content-Type-Options posé quand même, pas de CSP", () => {
    const cheminIndex = join(dossierTemp, "index.html");
    writeFileSync(cheminIndex, "<html><head></head></html>");

    const middleware = creerEntetesSecurite(cheminIndex);
    const res = creerResponseMock();
    const next = vi.fn();

    middleware({} as Request, res, next);

    expect(res.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(res.setHeader).not.toHaveBeenCalledWith("Content-Security-Policy", expect.anything());
  });

  it("la CSP est lue UNE SEULE FOIS au montage, pas à chaque requête (même après modification du fichier)", () => {
    const cheminIndex = join(dossierTemp, "index.html");
    writeFileSync(
      cheminIndex,
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self'" />`
    );
    const middleware = creerEntetesSecurite(cheminIndex);

    writeFileSync(
      cheminIndex,
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'" />`
    );

    const res = creerResponseMock();
    middleware({} as Request, res, vi.fn());

    expect(res.setHeader).toHaveBeenCalledWith("Content-Security-Policy", "default-src 'self'");
  });
});
