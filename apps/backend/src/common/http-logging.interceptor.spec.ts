import { Logger, type CallHandler, type ExecutionContext } from "@nestjs/common";
import { of } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpLoggingInterceptor } from "./http-logging.interceptor";

interface RequeteSimulee {
  method: string;
  path: string;
  body?: unknown;
  headers?: unknown;
}

function creerContexte(request: RequeteSimulee): { context: ExecutionContext; emettreFinish: (statusCode: number) => void } {
  const listeners: Record<string, () => void> = {};
  const response = {
    statusCode: 200,
    on: (event: string, callback: () => void) => {
      listeners[event] = callback;
    }
  };
  const emettreFinish = (statusCode: number): void => {
    // Même ordre que Express en conditions réelles : statusCode fixé avant
    // l'émission de l'événement "finish".
    response.statusCode = statusCode;
    listeners["finish"]?.();
  };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response
    })
  } as unknown as ExecutionContext;
  return { context, emettreFinish };
}

describe("HttpLoggingInterceptor", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("journalise en info (log) une réponse 2xx, avec méthode + chemin + statut + durée", () => {
    const interceptor = new HttpLoggingInterceptor();
    const { context, emettreFinish } = creerContexte({ method: "GET", path: "/health" });
    const nextEspion: CallHandler = { handle: () => of({ status: "ok" }) };

    interceptor.intercept(context, nextEspion).subscribe();
    emettreFinish(200);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]?.[0]).toMatch(/^GET \/health 200 \d+ms$/);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("journalise en warn (pas error, pas log) une réponse 4xx", () => {
    const interceptor = new HttpLoggingInterceptor();
    const { context, emettreFinish } = creerContexte({ method: "POST", path: "/auth/login" });
    const nextEspion: CallHandler = { handle: () => of(undefined) };

    interceptor.intercept(context, nextEspion).subscribe();
    emettreFinish(401);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/^POST \/auth\/login 401 \d+ms$/);
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("journalise en error (pas warn, pas log) une réponse 5xx", () => {
    const interceptor = new HttpLoggingInterceptor();
    const { context, emettreFinish } = creerContexte({ method: "POST", path: "/auth/login" });
    const nextEspion: CallHandler = { handle: () => of(undefined) };

    interceptor.intercept(context, nextEspion).subscribe();
    emettreFinish(500);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/^POST \/auth\/login 500 \d+ms$/);
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("ne journalise rien tant que la réponse n'est pas terminée (\"finish\" jamais émis)", () => {
    const interceptor = new HttpLoggingInterceptor();
    const { context } = creerContexte({ method: "GET", path: "/health" });
    const nextEspion: CallHandler = { handle: () => of({ status: "ok" }) };

    interceptor.intercept(context, nextEspion).subscribe();

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("ne journalise jamais le corps de la requête ni les en-têtes, même s'ils contiennent des données sensibles", () => {
    const interceptor = new HttpLoggingInterceptor();
    const { context, emettreFinish } = creerContexte({
      method: "POST",
      path: "/auth/login",
      body: { email: "jimmy@example.com", password: "secret-tres-sensible" },
      headers: { authorization: "Bearer un-jeton-tres-sensible" }
    });
    const nextEspion: CallHandler = { handle: () => of(undefined) };

    interceptor.intercept(context, nextEspion).subscribe();
    emettreFinish(401);

    const message = warnSpy.mock.calls[0]?.[0] as string;
    expect(message).toMatch(/^POST \/auth\/login 401 \d+ms$/);
    expect(message).not.toContain("secret-tres-sensible");
    expect(message).not.toContain("un-jeton-tres-sensible");
    expect(message).not.toContain("jimmy@example.com");
  });

  it("transmet la valeur de next.handle() sans la transformer", () => {
    const interceptor = new HttpLoggingInterceptor();
    const valeur = { peu: "importe" };
    const { context } = creerContexte({ method: "GET", path: "/health" });
    const nextEspion: CallHandler = { handle: () => of(valeur) };

    let valeurRecue: unknown;
    interceptor.intercept(context, nextEspion).subscribe((v) => {
      valeurRecue = v;
    });

    expect(valeurRecue).toBe(valeur);
  });
});
