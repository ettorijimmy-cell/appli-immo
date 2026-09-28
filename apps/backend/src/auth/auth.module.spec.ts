import "reflect-metadata";
import { JwtService } from "@nestjs/jwt";
import { describe, expect, it } from "vitest";
import { resoudreExpirationJwtSecondes } from "./auth.module";

describe("resoudreExpirationJwtSecondes", () => {
  it("convertit une chaîne numérique valide en nombre", () => {
    expect(resoudreExpirationJwtSecondes("3600")).toBe(3600);
    expect(resoudreExpirationJwtSecondes("7200")).toBe(7200);
  });

  it("retombe sur 3600 si la variable est absente", () => {
    expect(resoudreExpirationJwtSecondes(undefined)).toBe(3600);
  });

  it("retombe sur 3600 si la chaîne est vide", () => {
    expect(resoudreExpirationJwtSecondes("")).toBe(3600);
  });

  it("retombe sur 3600 si la chaîne n'est pas un nombre", () => {
    expect(resoudreExpirationJwtSecondes("abc")).toBe(3600);
  });

  it("retombe sur 3600 pour une valeur nulle ou négative (durée non valide)", () => {
    expect(resoudreExpirationJwtSecondes("0")).toBe(3600);
    expect(resoudreExpirationJwtSecondes("-100")).toBe(3600);
  });
});

describe("Signature JWT — durée d'expiration (régression 2026-09-28)", () => {
  // Incident réel : JWT_EXPIRES_IN_SECONDS="3600" (chaîne, exactement la
  // valeur affichée dans la console Scaleway, aucune faute de frappe)
  // produisait un jeton expirant 3 secondes après l'émission plutôt que
  // 3600 — voir le commentaire dans auth.module.ts pour le mécanisme exact
  // (ConfigService.get<number>() ne convertit jamais réellement la valeur,
  // et jsonwebtoken interprète une chaîne sans unité comme des
  // millisecondes, pas des secondes). Ce test signe un vrai jeton avec le
  // vrai JwtService, exactement comme le fait AuthModule, pour empêcher
  // cette régression de revenir silencieusement.
  it("un jeton signé avec JWT_EXPIRES_IN_SECONDS='3600' (chaîne) expire à 3600 secondes, pas 3", () => {
    const jwtService = new JwtService({
      secret: "secret-de-test-sans-rapport-avec-la-production",
      signOptions: { expiresIn: resoudreExpirationJwtSecondes("3600") }
    });

    const token = jwtService.sign({ sub: "utilisateur-test" });
    const decoded = jwtService.decode(token) as { iat: number; exp: number };

    expect(decoded.exp - decoded.iat).toBe(3600);
  });
});
