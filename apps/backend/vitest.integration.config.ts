import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

const enCi = process.env.CI === "true" || process.env.CI === "1";

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    environment: "node",
    include: ["**/*.integration.spec.ts"],
    // CI uniquement (runner partagé, ressources limitées) : sérialise
    // l'exécution des fichiers de test pour éliminer toute contention entre
    // plusieurs TestingModule NestJS compilés en parallèle — voir
    // docs/error-log.md, [2026-08-10] (alertes.integration.spec.ts échouait
    // de façon non déterministe, cause exacte jamais confirmée par des logs
    // bruts). En local, parallélisme par défaut conservé (rapide, le
    // problème ne s'y est jamais reproduit).
    poolOptions: enCi ? { threads: { singleThread: true } } : undefined
  }
});
