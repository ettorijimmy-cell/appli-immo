import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GotenbergService } from "../gotenberg/gotenberg.service";
import { creerSimulateurGotenberg, type SimulateurGotenberg } from "../test-utils/gotenberg-simulateur";
import { DiagnosticGotenbergService } from "./diagnostic-gotenberg.service";

function configServiceFactice(valeurs: Record<string, string | undefined>): ConfigService {
  return { get: (cle: string) => valeurs[cle] } as unknown as ConfigService;
}

function creerService(valeurs: Record<string, string | undefined>): DiagnosticGotenbergService {
  const configService = configServiceFactice(valeurs);
  return new DiagnosticGotenbergService(configService, new GotenbergService(configService));
}

describe("DiagnosticGotenbergService", () => {
  const fetchOriginal = global.fetch;
  let simulateur: SimulateurGotenberg | null = null;

  afterEach(async () => {
    global.fetch = fetchOriginal;
    vi.restoreAllMocks();
    if (simulateur) {
      await simulateur.fermer();
      simulateur = null;
    }
  });

  describe("configure", () => {
    it("'absente' : GOTENBERG_URL non renseignée, aucun appel réseau, sante/authExigee/conversion absents", async () => {
      const fetchEspion = vi.fn();
      global.fetch = fetchEspion as unknown as typeof fetch;

      const resultat = await creerService({}).executer();

      expect(resultat).toEqual({ configure: "absente", sante: null, authExigee: null, conversion: null });
      expect(fetchEspion).not.toHaveBeenCalled();
    });

    it("'identifiants_partiels' : un seul des deux identifiants renseigné, aucun appel réseau", async () => {
      vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      const fetchEspion = vi.fn();
      global.fetch = fetchEspion as unknown as typeof fetch;

      const resultat = await creerService({
        GOTENBERG_URL: "https://gotenberg.internal",
        GOTENBERG_BASIC_AUTH_USERNAME: "jimmy"
      }).executer();

      expect(resultat).toEqual({
        configure: "identifiants_partiels",
        sante: null,
        authExigee: null,
        conversion: null
      });
      expect(fetchEspion).not.toHaveBeenCalled();
    });
  });

  describe("configure 'ok', Gotenberg n'exige pas d'authentification (simulateur par défaut)", () => {
    it("sante.codeHttp 200, authExigee false, conversion.pdfValide true", async () => {
      simulateur = await creerSimulateurGotenberg();

      const resultat = await creerService({ GOTENBERG_URL: simulateur.url }).executer();

      expect(resultat.configure).toBe("ok");
      expect(resultat.sante).toEqual({ codeHttp: 200, dureeMs: expect.any(Number) });
      expect(resultat.authExigee).toBe(false);
      expect(resultat.conversion).toEqual({ pdfValide: true, dureeMs: expect.any(Number), erreur: null });
    });
  });

  describe("configure 'ok', Gotenberg exige l'authentification", () => {
    it("authExigee true (sonde volontairement sans identifiants) ; conversion réussit (identifiants fournis à GotenbergService)", async () => {
      simulateur = await creerSimulateurGotenberg({ identifiantsExiges: { username: "jimmy", password: "un-secret" } });

      const resultat = await creerService({
        GOTENBERG_URL: simulateur.url,
        GOTENBERG_BASIC_AUTH_USERNAME: "jimmy",
        GOTENBERG_BASIC_AUTH_PASSWORD: "un-secret"
      }).executer();

      expect(resultat.authExigee).toBe(true);
      expect(resultat.conversion).toEqual({ pdfValide: true, dureeMs: expect.any(Number), erreur: null });
    });
  });

  describe("sante", () => {
    it("reflète un code HTTP non-200 renvoyé par Gotenberg", async () => {
      simulateur = await creerSimulateurGotenberg();
      simulateur.definirStatutSante(500);

      const resultat = await creerService({ GOTENBERG_URL: simulateur.url }).executer();

      expect(resultat.sante).toEqual({ codeHttp: 500, dureeMs: expect.any(Number) });
    });
  });

  describe("échec réseau total (Gotenberg inatteignable)", () => {
    it("sante.codeHttp null, authExigee false, conversion.erreur 'indisponible'", async () => {
      global.fetch = vi.fn(async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch;

      const resultat = await creerService({ GOTENBERG_URL: "https://gotenberg.internal" }).executer();

      expect(resultat.sante).toEqual({ codeHttp: null, dureeMs: expect.any(Number) });
      expect(resultat.authExigee).toBe(false);
      expect(resultat.conversion).toEqual({ pdfValide: false, dureeMs: expect.any(Number), erreur: "indisponible" });
    });
  });

  describe("conversion — types d'erreur (voir GotenbergIndisponibleError/GotenbergConversionError)", () => {
    it("HTTP 503 → erreur 'indisponible' (transitoire, à relancer)", async () => {
      simulateur = await creerSimulateurGotenberg();
      simulateur.definirComportement({ type: "erreur", statut: 503 });

      const resultat = await creerService({ GOTENBERG_URL: simulateur.url }).executer();

      expect(resultat.conversion).toEqual({ pdfValide: false, dureeMs: expect.any(Number), erreur: "indisponible" });
    });

    it("HTTP 500 → erreur 'conversion' (rejouerait identiquement)", async () => {
      simulateur = await creerSimulateurGotenberg();
      simulateur.definirComportement({ type: "erreur", statut: 500 });

      const resultat = await creerService({ GOTENBERG_URL: simulateur.url }).executer();

      expect(resultat.conversion).toEqual({ pdfValide: false, dureeMs: expect.any(Number), erreur: "conversion" });
    });
  });

  describe("aucun secret ni URL complète dans la réponse", () => {
    it("ne contient ni l'identifiant, ni le mot de passe, ni l'URL de Gotenberg", async () => {
      simulateur = await creerSimulateurGotenberg({
        identifiantsExiges: { username: "jimmy", password: "un-secret-tres-sensible" }
      });

      const resultat = await creerService({
        GOTENBERG_URL: simulateur.url,
        GOTENBERG_BASIC_AUTH_USERNAME: "jimmy",
        GOTENBERG_BASIC_AUTH_PASSWORD: "un-secret-tres-sensible"
      }).executer();

      const texte = JSON.stringify(resultat);
      expect(texte).not.toContain("un-secret-tres-sensible");
      expect(texte).not.toContain("jimmy");
      expect(texte).not.toContain(simulateur.url);
    });
  });
});
