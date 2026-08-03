import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Pas encore de logique testable (routes de base seulement) — évite un
    // échec de pipeline pour absence de tests plutôt qu'un vrai problème.
    // À retirer dès le premier vrai test ajouté.
    passWithNoTests: true
  }
});
