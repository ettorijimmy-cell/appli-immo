import { Controller, Get } from "@nestjs/common";
import { Public } from "./auth/public.decorator";

// Healthcheck pour Scaleway Serverless Containers (hébergement backend,
// 2026-09-22) — vivacité pure (le process répond), volontairement sans
// vérification DB : un hoquet passager du pool Postgres ne doit pas faire
// passer un conteneur par ailleurs sain pour défaillant aux yeux de
// Scaleway.
@Controller()
export class AppController {
  @Public()
  @Get("health")
  health() {
    return { status: "ok" };
  }
}
