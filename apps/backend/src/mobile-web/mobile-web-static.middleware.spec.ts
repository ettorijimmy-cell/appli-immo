import { describe, expect, it } from "vitest";
import { ressembleAUnFichier } from "./mobile-web-static.middleware";

describe("ressembleAUnFichier", () => {
  it("un nom de fichier avec extension (dernier segment) : vrai", () => {
    expect(ressembleAUnFichier("/mobile/assets/ancien.js")).toBe(true);
    expect(ressembleAUnFichier("/mobile/favicon.ico")).toBe(true);
  });

  it("une route de l'appli React, sans extension : faux", () => {
    expect(ressembleAUnFichier("/mobile/bail/123")).toBe(false);
    expect(ressembleAUnFichier("/mobile/")).toBe(false);
    expect(ressembleAUnFichier("/mobile")).toBe(false);
  });

  it("un identifiant contenant un point n'est pas confondu avec un segment intermédiaire : seul le DERNIER segment compte", () => {
    expect(ressembleAUnFichier("/mobile/assets/v1.2/bail")).toBe(false);
  });

  it("extension à un seul caractère ou plusieurs points dans le dernier segment : vrai (c'est le dernier point qui compte)", () => {
    expect(ressembleAUnFichier("/mobile/robots.txt")).toBe(true);
    expect(ressembleAUnFichier("/mobile/archive.tar.gz")).toBe(true);
  });
});
