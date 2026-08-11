import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { describe, expect, it, vi } from "vitest";
import { JwtAuthGuard } from "./jwt-auth.guard";

function creerContexte(headers: Record<string, string>): ExecutionContext {
  const request = { headers, user: undefined };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => vi.fn(),
    getClass: () => vi.fn()
  } as unknown as ExecutionContext;
}

describe("JwtAuthGuard", () => {
  const jwtService = new JwtService({ secret: "test-secret" });

  it("laisse passer une route décorée @Public() sans vérifier de token", async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(true) } as unknown as Reflector;
    const guard = new JwtAuthGuard(jwtService, reflector);

    await expect(guard.canActivate(creerContexte({}))).resolves.toBe(true);
  });

  it("rejette une route non publique sans en-tête Authorization", async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    const guard = new JwtAuthGuard(jwtService, reflector);

    await expect(guard.canActivate(creerContexte({}))).rejects.toThrow();
  });

  it("rejette un token invalide", async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    const guard = new JwtAuthGuard(jwtService, reflector);

    await expect(
      guard.canActivate(creerContexte({ authorization: "Bearer token-invalide" }))
    ).rejects.toThrow();
  });

  it("accepte un token valide et pose request.user", async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    const guard = new JwtAuthGuard(jwtService, reflector);
    const token = jwtService.sign({ sub: "utilisateur-test", email: "test@example.com" });
    const context = creerContexte({ authorization: `Bearer ${token}` });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    const request = context.switchToHttp().getRequest<{ user?: { sub: string } }>();
    expect(request.user?.sub).toBe("utilisateur-test");
  });
});
