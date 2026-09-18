import "express";

declare module "express" {
  interface Request {
    // organisationId ajouté au JWT le 2026-09-18 (chantier scoping
    // multi-organisation) — décodé directement par JwtAuthGuard, jamais
    // recalculé via un lookup DB à chaque requête.
    user?: { sub: string; email: string; organisationId: string };
  }
}
