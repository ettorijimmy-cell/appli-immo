import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GotenbergConversionError, GotenbergIndisponibleError } from "./gotenberg.errors";
import { GotenbergService } from "./gotenberg.service";

function configServiceFactice(valeurs: Record<string, string | undefined>): ConfigService {
  return { get: (cle: string) => valeurs[cle] } as unknown as ConfigService;
}

const CONFIG_AVEC_AUTH = {
  GOTENBERG_URL: "https://gotenberg.internal",
  GOTENBERG_BASIC_AUTH_USERNAME: "jimmy",
  GOTENBERG_BASIC_AUTH_PASSWORD: "un-secret-tres-sensible"
};
const BASIC_ATTENDU = `Basic ${Buffer.from("jimmy:un-secret-tres-sensible").toString("base64")}`;

describe("GotenbergService", () => {
  const fetchOriginal = global.fetch;

  afterEach(() => {
    global.fetch = fetchOriginal;
    vi.restoreAllMocks();
  });

  describe("sans GOTENBERG_URL (variable absente)", () => {
    const service = new GotenbergService(configServiceFactice({}));

    it("estConfigure() renvoie false", () => {
      expect(service.estConfigure()).toBe(false);
    });

    it("convertirDocxEnPdf() rejette avec GotenbergIndisponibleError, sans jamais appeler fetch", async () => {
      const fetchEspion = vi.fn();
      global.fetch = fetchEspion as unknown as typeof fetch;

      await expect(service.convertirDocxEnPdf(Buffer.from("docx"), "test.docx")).rejects.toThrow(
        GotenbergIndisponibleError
      );
      expect(fetchEspion).not.toHaveBeenCalled();
    });
  });

  describe("identifiants Basic Auth partiels (un seul des deux renseigné)", () => {
    it.each([
      { GOTENBERG_URL: "https://gotenberg.internal", GOTENBERG_BASIC_AUTH_USERNAME: "jimmy" },
      { GOTENBERG_URL: "https://gotenberg.internal", GOTENBERG_BASIC_AUTH_PASSWORD: "un-secret" }
    ])("traité comme non configuré, avec un avertissement explicite au démarrage (%j)", (valeurs) => {
      const avertissementEspion = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      const service = new GotenbergService(configServiceFactice(valeurs));

      expect(service.estConfigure()).toBe(false);
      expect(avertissementEspion).toHaveBeenCalledTimes(1);
      const message = avertissementEspion.mock.calls[0]?.[0];
      expect(message).toMatch(/GOTENBERG_BASIC_AUTH_USERNAME/);
      expect(message).toMatch(/GOTENBERG_BASIC_AUTH_PASSWORD/);
      // Message distinct de celui pour "GOTENBERG_URL absente" — on
      // vérifie qu'il ne s'agit pas du même avertissement générique.
      expect(message).not.toMatch(/GOTENBERG_URL absente/);
    });

    it("convertirDocxEnPdf() rejette avec GotenbergIndisponibleError, sans jamais appeler fetch", async () => {
      vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      const fetchEspion = vi.fn();
      global.fetch = fetchEspion as unknown as typeof fetch;

      const service = new GotenbergService(
        configServiceFactice({ GOTENBERG_URL: "https://gotenberg.internal", GOTENBERG_BASIC_AUTH_USERNAME: "jimmy" })
      );
      await expect(service.convertirDocxEnPdf(Buffer.from("docx"), "test.docx")).rejects.toThrow(
        GotenbergIndisponibleError
      );
      expect(fetchEspion).not.toHaveBeenCalled();
    });
  });

  describe("avec GOTENBERG_URL configurée", () => {
    it("estConfigure() renvoie true", () => {
      const service = new GotenbergService(configServiceFactice(CONFIG_AVEC_AUTH));
      expect(service.estConfigure()).toBe(true);
    });

    function reponsePdfValide(contenu: Buffer): Response {
      return new Response(contenu, { status: 200, headers: { "content-type": "application/pdf" } });
    }

    it("appelle POST /forms/libreoffice/convert avec l'en-tête Authorization Basic attendu, et renvoie le PDF reçu", async () => {
      const pdfAttendu = Buffer.concat([Buffer.from("%PDF-1.4 "), Buffer.from("contenu factice")]);
      const fetchEspion = vi.fn(async (url: string | URL, init?: RequestInit) => {
        expect(url).toBe("https://gotenberg.internal/forms/libreoffice/convert");
        expect(init?.method).toBe("POST");
        expect((init?.headers as Record<string, string>)["Authorization"]).toBe(BASIC_ATTENDU);
        expect(init?.body).toBeInstanceOf(FormData);
        const fichier = (init?.body as FormData).get("files");
        expect(fichier).toBeInstanceOf(Blob);
        expect((fichier as File).name).toBe("etat-des-lieux.docx");
        return reponsePdfValide(pdfAttendu);
      });
      global.fetch = fetchEspion as unknown as typeof fetch;

      const service = new GotenbergService(configServiceFactice(CONFIG_AVEC_AUTH));
      const pdf = await service.convertirDocxEnPdf(Buffer.from("docx factice"), "etat-des-lieux.docx");

      expect(pdf).toEqual(pdfAttendu);
      expect(fetchEspion).toHaveBeenCalledTimes(1);
    });

    it("n'envoie pas d'en-tête Authorization quand les identifiants Basic Auth sont absents", async () => {
      const fetchEspion = vi.fn(async (_url: string | URL, init?: RequestInit) => {
        expect((init?.headers as Record<string, string>)["Authorization"]).toBeUndefined();
        return reponsePdfValide(Buffer.from("%PDF-1.4 pdf"));
      });
      global.fetch = fetchEspion as unknown as typeof fetch;

      const service = new GotenbergService(configServiceFactice({ GOTENBERG_URL: "https://gotenberg.internal" }));
      await service.convertirDocxEnPdf(Buffer.from("docx"), "test.docx");
      expect(fetchEspion).toHaveBeenCalledTimes(1);
    });

    describe("typage des erreurs", () => {
      it("réseau (fetch rejette) : GotenbergIndisponibleError — transitoire, à relancer", async () => {
        global.fetch = vi.fn(async () => {
          throw new TypeError("fetch failed");
        }) as unknown as typeof fetch;

        const service = new GotenbergService(configServiceFactice(CONFIG_AVEC_AUTH));
        await expect(service.convertirDocxEnPdf(Buffer.from("docx"), "test.docx")).rejects.toThrow(
          GotenbergIndisponibleError
        );
      });

      it("délai dépassé (AbortError) : GotenbergIndisponibleError — transitoire, à relancer", async () => {
        global.fetch = vi.fn(async () => {
          const erreur = new Error("This operation was aborted");
          erreur.name = "TimeoutError";
          throw erreur;
        }) as unknown as typeof fetch;

        const service = new GotenbergService(configServiceFactice(CONFIG_AVEC_AUTH));
        await expect(service.convertirDocxEnPdf(Buffer.from("docx"), "test.docx")).rejects.toThrow(
          GotenbergIndisponibleError
        );
      });

      it.each([502, 503, 504])(
        "HTTP %i : GotenbergIndisponibleError — transitoire, à relancer",
        async (statut) => {
          global.fetch = vi.fn(async () => new Response("passerelle indisponible", { status: statut })) as unknown as typeof fetch;

          const service = new GotenbergService(configServiceFactice(CONFIG_AVEC_AUTH));
          await expect(service.convertirDocxEnPdf(Buffer.from("docx"), "test.docx")).rejects.toThrow(
            GotenbergIndisponibleError
          );
        }
      );

      it.each([400, 401, 404, 500])(
        "HTTP %i : GotenbergConversionError — rejouerait identiquement, jamais relancé en boucle",
        async (statut) => {
          global.fetch = vi.fn(async () => new Response("échec définitif", { status: statut })) as unknown as typeof fetch;

          const service = new GotenbergService(configServiceFactice(CONFIG_AVEC_AUTH));
          await expect(service.convertirDocxEnPdf(Buffer.from("docx"), "test.docx")).rejects.toThrow(
            GotenbergConversionError
          );
        }
      );

      it("message d'erreur HTTP non-relançable inclut le statut", async () => {
        global.fetch = vi.fn(async () => new Response("LibreOffice a planté", { status: 500 })) as unknown as typeof fetch;

        const service = new GotenbergService(configServiceFactice(CONFIG_AVEC_AUTH));
        await expect(service.convertirDocxEnPdf(Buffer.from("docx"), "test.docx")).rejects.toThrow(/500/);
      });
    });

    describe("validation de la réponse", () => {
      it("rejette avec GotenbergConversionError si Gotenberg répond une page HTML en 200 (ex. proxy/erreur silencieuse)", async () => {
        global.fetch = vi.fn(
          async () => new Response("<html><body>Erreur passerelle</body></html>", { status: 200, headers: { "content-type": "text/html" } })
        ) as unknown as typeof fetch;

        const service = new GotenbergService(configServiceFactice(CONFIG_AVEC_AUTH));
        await expect(service.convertirDocxEnPdf(Buffer.from("docx"), "test.docx")).rejects.toThrow(
          GotenbergConversionError
        );
      });

      it("rejette avec GotenbergConversionError si le Content-Type est 'application/pdf' mais le corps ne commence pas par '%PDF-'", async () => {
        global.fetch = vi.fn(
          async () => new Response("pas un vrai pdf", { status: 200, headers: { "content-type": "application/pdf" } })
        ) as unknown as typeof fetch;

        const service = new GotenbergService(configServiceFactice(CONFIG_AVEC_AUTH));
        await expect(service.convertirDocxEnPdf(Buffer.from("docx"), "test.docx")).rejects.toThrow(
          GotenbergConversionError
        );
      });

      it("accepte une réponse dont le Content-Type porte un paramètre additionnel (ex. charset)", async () => {
        global.fetch = vi.fn(
          async () => new Response("%PDF-1.4 ok", { status: 200, headers: { "content-type": "application/pdf; charset=binary" } })
        ) as unknown as typeof fetch;

        const service = new GotenbergService(configServiceFactice(CONFIG_AVEC_AUTH));
        await expect(service.convertirDocxEnPdf(Buffer.from("docx"), "test.docx")).resolves.toBeInstanceOf(Buffer);
      });
    });

    describe("aucun secret dans les logs ni dans les messages d'erreur", () => {
      it("ni l'identifiant, ni le mot de passe, ni l'en-tête Authorization n'apparaissent dans les erreurs ou les logs", async () => {
        const logsCaptures: string[] = [];
        vi.spyOn(Logger.prototype, "warn").mockImplementation((message: unknown) => {
          logsCaptures.push(String(message));
        });
        vi.spyOn(Logger.prototype, "error").mockImplementation((message: unknown) => {
          logsCaptures.push(String(message));
        });

        const messagesErreurs: string[] = [];

        // Config invalide (identifiants partiels) — log au constructeur.
        new GotenbergService(
          configServiceFactice({ GOTENBERG_URL: "https://gotenberg.internal", GOTENBERG_BASIC_AUTH_USERNAME: "jimmy" })
        );

        const service = new GotenbergService(configServiceFactice(CONFIG_AVEC_AUTH));

        // Échec réseau.
        global.fetch = vi.fn(async () => {
          throw new TypeError("fetch failed");
        }) as unknown as typeof fetch;
        await service.convertirDocxEnPdf(Buffer.from("docx"), "test.docx").catch((e) => messagesErreurs.push((e as Error).message));

        // Échec HTTP non-relançable (corps de réponse inclus dans le message).
        global.fetch = vi.fn(async () => new Response("erreur serveur", { status: 500 })) as unknown as typeof fetch;
        await service.convertirDocxEnPdf(Buffer.from("docx"), "test.docx").catch((e) => messagesErreurs.push((e as Error).message));

        // Réponse invalide.
        global.fetch = vi.fn(
          async () => new Response("<html>erreur</html>", { status: 200, headers: { "content-type": "text/html" } })
        ) as unknown as typeof fetch;
        await service.convertirDocxEnPdf(Buffer.from("docx"), "test.docx").catch((e) => messagesErreurs.push((e as Error).message));

        const toutLeTexte = [...logsCaptures, ...messagesErreurs].join("\n");
        expect(toutLeTexte).not.toContain("un-secret-tres-sensible");
        expect(toutLeTexte).not.toContain(BASIC_ATTENDU);
        expect(toutLeTexte.toLowerCase()).not.toContain("authorization");
        // "jimmy" seul n'est pas un secret en soi (nom d'utilisateur), mais
        // ne doit pas non plus apparaître — confirme qu'aucun des deux
        // identifiants n'est jamais interpolé.
        expect(toutLeTexte).not.toContain("jimmy");
      });
    });
  });
});
