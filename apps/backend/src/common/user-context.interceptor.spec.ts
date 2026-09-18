import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { of } from "rxjs";
import { describe, expect, it } from "vitest";
import { RequestContextService } from "./request-context";
import { UserContextInterceptor } from "./user-context.interceptor";

function creerContexte(user: { sub: string; email: string; organisationId: string } | undefined): ExecutionContext {
  const request = { user };
  return {
    switchToHttp: () => ({ getRequest: () => request })
  } as unknown as ExecutionContext;
}

describe("UserContextInterceptor", () => {
  it("pose utilisateurId et organisationId depuis request.user (JWT décodé), jamais un lookup DB", async () => {
    const requestContext = new RequestContextService();
    const interceptor = new UserContextInterceptor(requestContext);
    let utilisateurIdVu: string | null = null;
    let organisationIdVu: string | null = null;

    const nextEspion: CallHandler = {
      handle: () => {
        utilisateurIdVu = requestContext.getUtilisateurId();
        organisationIdVu = requestContext.getOrganisationId();
        return of(undefined);
      }
    };

    const context = creerContexte({ sub: "u1", email: "a@a.com", organisationId: "org-1" });
    await new Promise<void>((resolve) => {
      interceptor.intercept(context, nextEspion).subscribe({ complete: resolve });
    });

    expect(utilisateurIdVu).toBe("u1");
    expect(organisationIdVu).toBe("org-1");
  });

  it("pose utilisateurId/organisationId à null hors requête authentifiée (request.user absent)", async () => {
    const requestContext = new RequestContextService();
    const interceptor = new UserContextInterceptor(requestContext);
    let utilisateurIdVu: string | null = "non-null-par-defaut";
    let organisationIdVu: string | null = "non-null-par-defaut";

    const nextEspion: CallHandler = {
      handle: () => {
        utilisateurIdVu = requestContext.getUtilisateurId();
        organisationIdVu = requestContext.getOrganisationId();
        return of(undefined);
      }
    };

    const context = creerContexte(undefined);
    await new Promise<void>((resolve) => {
      interceptor.intercept(context, nextEspion).subscribe({ complete: resolve });
    });

    expect(utilisateurIdVu).toBeNull();
    expect(organisationIdVu).toBeNull();
  });
});
