import { resolve } from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

// Même garde-fou que apps/desktop (electron.vite.config.ts) : échec bruyant
// à la construction plutôt qu'un repli silencieux vers localhost dans un
// build livré — voir docs/error-log.md, section CSP/VITE_API_URL.
function requireApiUrlInProdPlugin(): Plugin {
  return {
    name: "appli-immo-require-api-url-in-prod",
    configResolved(config) {
      const isDev = config.command === "serve";
      const envApiUrl = config.env["VITE_API_URL"] as string | undefined;
      if (!isDev && !envApiUrl) {
        throw new Error(
          "VITE_API_URL doit être défini pour un build de production (voir .env.example)."
        );
      }
    }
  };
}

export default defineConfig({
  // Lit le .env à la racine du monorepo (un seul fichier .env pour tout le
  // projet), même convention que apps/desktop.
  envDir: resolve("../.."),
  plugins: [react(), requireApiUrlInProdPlugin()],
  // host: true écoute sur 0.0.0.0 (toutes les interfaces), pas seulement
  // localhost — nécessaire pour ouvrir le parcours de capture depuis un
  // téléphone sur le même réseau local pendant les visites.
  server: { host: true }
});
