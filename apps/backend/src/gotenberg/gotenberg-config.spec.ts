import { describe, expect, it } from "vitest";
import { resoudreConfigGotenberg } from "./gotenberg-config";

function lireDepuis(valeurs: Record<string, string | undefined>): (cle: string) => string | undefined {
  return (cle) => valeurs[cle];
}

describe("resoudreConfigGotenberg", () => {
  it("statut 'absente' si GOTENBERG_URL est absente — aucune autre variable ne compte", () => {
    expect(
      resoudreConfigGotenberg(
        lireDepuis({
          GOTENBERG_BASIC_AUTH_USERNAME: "jimmy",
          GOTENBERG_BASIC_AUTH_PASSWORD: "secret"
        })
      )
    ).toEqual({ statut: "absente" });
  });

  it("statut 'absente' si GOTENBERG_URL est une chaîne vide", () => {
    expect(resoudreConfigGotenberg(lireDepuis({ GOTENBERG_URL: "" }))).toEqual({ statut: "absente" });
  });

  it("URL seule : statut 'ok', config minimale avec le délai par défaut, sans identifiants Basic Auth", () => {
    expect(resoudreConfigGotenberg(lireDepuis({ GOTENBERG_URL: "https://gotenberg.internal" }))).toEqual({
      statut: "ok",
      config: {
        url: "https://gotenberg.internal",
        basicAuthUsername: undefined,
        basicAuthPassword: undefined,
        timeoutMs: 60_000
      }
    });
  });

  it("statut 'ok' : reprend les identifiants Basic Auth et le délai personnalisé quand ils sont fournis", () => {
    expect(
      resoudreConfigGotenberg(
        lireDepuis({
          GOTENBERG_URL: "https://gotenberg.internal",
          GOTENBERG_BASIC_AUTH_USERNAME: "jimmy",
          GOTENBERG_BASIC_AUTH_PASSWORD: "secret",
          GOTENBERG_TIMEOUT_MS: "15000"
        })
      )
    ).toEqual({
      statut: "ok",
      config: {
        url: "https://gotenberg.internal",
        basicAuthUsername: "jimmy",
        basicAuthPassword: "secret",
        timeoutMs: 15_000
      }
    });
  });

  it.each(["pas-un-nombre", "-5", "0", ""])(
    "statut 'ok' : retombe sur le délai par défaut si GOTENBERG_TIMEOUT_MS est invalide (%s)",
    (valeurInvalide) => {
      const resultat = resoudreConfigGotenberg(
        lireDepuis({ GOTENBERG_URL: "https://gotenberg.internal", GOTENBERG_TIMEOUT_MS: valeurInvalide })
      );
      expect(resultat.statut).toBe("ok");
      expect(resultat.statut === "ok" && resultat.config.timeoutMs).toBe(60_000);
    }
  );

  it.each([
    { GOTENBERG_BASIC_AUTH_USERNAME: "jimmy" },
    { GOTENBERG_BASIC_AUTH_PASSWORD: "secret" }
  ])("statut 'identifiants_partiels' quand un seul des deux identifiants Basic Auth est présent (%j)", (partiel) => {
    expect(resoudreConfigGotenberg(lireDepuis({ GOTENBERG_URL: "https://gotenberg.internal", ...partiel }))).toEqual({
      statut: "identifiants_partiels"
    });
  });

  it("statut 'ok' quand les deux identifiants Basic Auth sont absents ensemble", () => {
    const resultat = resoudreConfigGotenberg(lireDepuis({ GOTENBERG_URL: "https://gotenberg.internal" }));
    expect(resultat.statut).toBe("ok");
  });
});
