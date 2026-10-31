import { ConflictException, Logger, type ArgumentsHost } from "@nestjs/common";
import type { HttpServer } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AllExceptionsFilter } from "./all-exceptions.filter";

// httpAdapter minimal : seules les deux méthodes que BaseExceptionFilter
// appelle réellement pour une réponse jamais encore envoyée (le cas normal
// ici — aucun test de ce fichier n'envoie de vraie réponse HTTP). Cast
// explicite : HttpServer expose des dizaines de méthodes (get/post/use...)
// jamais appelées par BaseExceptionFilter.handleUnknownError, inutiles à
// factices ici.
function httpAdapterFactice(): HttpServer & { reply: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> } {
  return {
    isHeadersSent: vi.fn().mockReturnValue(false),
    reply: vi.fn(),
    end: vi.fn()
  } as unknown as HttpServer & { reply: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
}

// ArgumentsHost minimal : seul getArgByIndex(1) est lu par
// BaseExceptionFilter (la "réponse", jamais utilisée au-delà d'être
// transmise telle quelle à httpAdapter.reply ci-dessus).
function argumentsHostFactice(): ArgumentsHost {
  const reponse = {};
  return {
    switchToHttp: () => ({ getRequest: () => ({}), getResponse: () => reponse }),
    getArgByIndex: () => reponse
  } as unknown as ArgumentsHost;
}

describe("AllExceptionsFilter", () => {
  afterEach(() => {
    // Logger.prototype est un prototype PARTAGÉ par tout le process — même
    // raison que etat-des-lieux-pdf.integration.spec.ts, jamais laisser un
    // espion fuiter vers un autre fichier de test du même worker Vitest.
    vi.restoreAllMocks();
  });

  it("journalise la cause et la pile d'une exception vraiment inattendue (jamais une HttpException), puis délègue la réponse par défaut", () => {
    const httpAdapter = httpAdapterFactice();
    const errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const filtre = new AllExceptionsFilter(httpAdapter);
    const exception = new Error("ENOENT: no such file or directory");

    filtre.catch(exception, argumentsHostFactice());

    expect(errorSpy).toHaveBeenCalledWith(exception.message, exception.stack);
    expect(httpAdapter.reply).toHaveBeenCalledOnce();
  });

  it("ne journalise rien pour une HttpException levée volontairement (déjà pensée pour le client)", () => {
    const httpAdapter = httpAdapterFactice();
    const errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const filtre = new AllExceptionsFilter(httpAdapter);

    filtre.catch(new ConflictException("La phase 'entree' n'est pas signée."), argumentsHostFactice());

    expect(errorSpy).not.toHaveBeenCalled();
    expect(httpAdapter.reply).toHaveBeenCalledOnce();
  });

  it("journalise aussi une exception qui n'est pas une instance d'Error (rejet avec une valeur quelconque)", () => {
    const httpAdapter = httpAdapterFactice();
    const errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const filtre = new AllExceptionsFilter(httpAdapter);

    filtre.catch("une chaîne rejetée directement", argumentsHostFactice());

    expect(errorSpy).toHaveBeenCalledWith("une chaîne rejetée directement", undefined);
  });
});
