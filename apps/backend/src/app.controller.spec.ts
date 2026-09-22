import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { AppController } from "./app.controller";
import { IS_PUBLIC_KEY } from "./auth/public.decorator";

// Pas d'infrastructure de test HTTP/supertest dans ce backend (voir
// app.module.spec.ts) : la vérification "accessible sans JWT" se fait
// directement sur la métadonnée posée par @Public(), lue par JwtAuthGuard
// (jwt-auth.guard.ts) — même niveau de test que jwt-auth.guard.spec.ts,
// qui vérifie le comportement de la garde pour une métadonnée `isPublic`
// à `true`.
describe("AppController", () => {
  it("GET /health répond { status: 'ok' }", () => {
    const controller = new AppController();
    expect(controller.health()).toEqual({ status: "ok" });
  });

  it("health() est marquée @Public() — accessible sans JWT", () => {
    const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, AppController.prototype.health);
    expect(isPublic).toBe(true);
  });
});
