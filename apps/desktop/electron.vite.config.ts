import { resolve } from "path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { Plugin } from "vite";

const DEFAULT_API_URL = "http://localhost:3000";

// CSP différenciée dev/prod : en dev, le client HMR de Vite a besoin
// d'injecter des styles inline (jamais présent dans le build de
// production, donc sans impact sur la sécurité de l'app livrée). En prod,
// aucun relâchement — voir CLAUDE.md, Règles importantes.
//
// connect-src suit VITE_API_URL (même variable que
// src/renderer/src/lib/api-config.ts, même fallback) — pas d'origine
// backend codée en dur, pour ne rien avoir à changer ici une fois le
// backend déployé sur Scaleway.
function cspPlugin(): Plugin {
  let isDev = false;
  let apiUrl = DEFAULT_API_URL;
  return {
    name: "appli-immo-csp",
    configResolved(config) {
      // Plus fiable que ctx.server dans transformIndexHtml, qui ne reflète
      // pas toujours correctement le mode dev sous electron-vite.
      isDev = config.command === "serve";
      apiUrl = (config.env["VITE_API_URL"] as string | undefined) ?? DEFAULT_API_URL;
    },
    transformIndexHtml(html) {
      const csp = isDev
        ? `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ${apiUrl}`
        : `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ${apiUrl}`;
      // \s+ (pas un espace littéral) : la balise <meta> source est
      // multi-ligne dans index.html, un espace simple ne matchait pas.
      return html.replace(
        /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/,
        `<meta http-equiv="Content-Security-Policy" content="${csp}" />`
      );
    }
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    // Lit le .env à la racine du monorepo (un seul fichier .env pour tout
    // le projet, voir .env.example) plutôt que d'en exiger un séparé ici.
    envDir: resolve("../.."),
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src")
      }
    },
    plugins: [react(), cspPlugin()]
  }
});
