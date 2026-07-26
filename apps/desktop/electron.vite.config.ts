import { resolve } from "path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { Plugin } from "vite";

// CSP différenciée dev/prod : en dev, le client HMR de Vite a besoin
// d'injecter des styles inline (jamais présent dans le build de
// production, donc sans impact sur la sécurité de l'app livrée). En prod,
// aucun relâchement — voir CLAUDE.md, Règles importantes.
//
// http://localhost:3000 est la seule origine backend qui existe pour
// l'instant (pas encore de déploiement Scaleway) ; à remplacer par
// l'origine HTTPS réelle une fois le backend déployé, dans les deux CSP.
function cspPlugin(): Plugin {
  let isDev = false;
  return {
    name: "appli-immo-csp",
    configResolved(config) {
      // Plus fiable que ctx.server dans transformIndexHtml, qui ne reflète
      // pas toujours correctement le mode dev sous electron-vite.
      isDev = config.command === "serve";
    },
    transformIndexHtml(html) {
      const csp = isDev
        ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:3000"
        : "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' http://localhost:3000";
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
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src")
      }
    },
    plugins: [react(), cspPlugin()]
  }
});
