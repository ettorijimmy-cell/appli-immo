import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    environment: "node",
    include: ["**/*.integration.spec.ts"],
    // Défaut Vitest (10s) trop court pour compiler un TestingModule NestJS
    // qui importe de nombreux modules (ex. alertes.integration.spec.ts,
    // 9 modules) sur un runner CI partagé/plus lent qu'une machine de dev —
    // voir docs/error-log.md, [2026-08-10].
    hookTimeout: 30000
  }
});
