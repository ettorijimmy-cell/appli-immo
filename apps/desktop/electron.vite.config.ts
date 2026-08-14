import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { resolve } from "path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { Plugin } from "vite";

const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
};
const runtimeDependencyNames = Object.keys(pkg.dependencies ?? {});

// Repli utilisable UNIQUEMENT en dev (voir garde-fou ci-dessous) — jamais
// silencieusement actif dans un build de production.
const DEFAULT_DEV_API_URL = "http://localhost:3000";
const CSP_PLACEHOLDER = "__CSP__";

// CSP différenciée dev/prod : en dev, le client HMR de Vite a besoin
// d'injecter des styles inline (jamais présent dans le build de
// production, donc sans impact sur la sécurité de l'app livrée). En prod,
// aucun relâchement — voir CLAUDE.md, Règles importantes.
//
// connect-src suit VITE_API_URL (même variable que
// src/renderer/src/lib/api-config.ts) — pas d'origine backend codée en
// dur, pour ne rien avoir à changer ici une fois le backend déployé sur
// Scaleway.
function cspPlugin(): Plugin {
  let isDev = false;
  let apiUrl = DEFAULT_DEV_API_URL;
  return {
    name: "appli-immo-csp",
    configResolved(config) {
      // Plus fiable que ctx.server dans transformIndexHtml, qui ne reflète
      // pas toujours correctement le mode dev sous electron-vite.
      isDev = config.command === "serve";
      const envApiUrl = config.env["VITE_API_URL"] as string | undefined;

      // Échec bruyant plutôt qu'un repli silencieux vers localhost:3000
      // dans un build livré — voir docs/error-log.md.
      if (!isDev && !envApiUrl) {
        throw new Error(
          "VITE_API_URL doit être défini pour un build de production (voir .env.example)."
        );
      }

      apiUrl = envApiUrl ?? DEFAULT_DEV_API_URL;
    },
    transformIndexHtml(html) {
      // img-src 'self' blob: — nécessaire aux vignettes photo de l'état des
      // lieux (2026-08-07) : le contenu vient de /documents/:id/contenu
      // (authentifié, jamais d'URL publique), converti en URL blob: en
      // mémoire par le renderer pour affichage inline. Sans cette
      // directive, default-src 'self' s'applique en repli et bloque le
      // rendu de <img src="blob:...">, silencieusement (pas d'exception
      // JS interceptable, juste une icône cassée) — voir docs/error-log.md,
      // [2026-07-26] CSP bloquait le login Electron, pour le précédent
      // connect-src qui a le même mécanisme de repli. Scope volontairement
      // minimal : blob: uniquement, jamais d'origine distante. Même
      // directive en dev et en prod — l'affichage des vignettes est une
      // fonctionnalité du produit, pas une commodité de développement.
      const csp = isDev
        ? `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self' ${apiUrl}`
        : `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self' ${apiUrl}`;
      // Recherche d'un placeholder littéral, pas une regex sur la balise :
      // insensible à toute mise en forme HTML environnante. Échec bruyant
      // si absent plutôt qu'un remplacement silencieusement ignoré (cause
      // du bug précédent — voir docs/error-log.md).
      if (!html.includes(CSP_PLACEHOLDER)) {
        throw new Error(
          `${CSP_PLACEHOLDER} introuvable dans index.html : la CSP ne serait pas appliquée.`
        );
      }
      return html.replaceAll(CSP_PLACEHOLDER, csp);
    }
  };
}

export default defineConfig({
  main: {
    // Entrée séparée pour le worker PowerSync (database.worker.ts) : ne
    // doit jamais être inlinée dans index.js, chargée dynamiquement au
    // runtime via new Worker(...) — voir src/main/powersync/index.ts.
    // Sortie à plat (out/main/powersync-worker.js), pas de sous-dossier,
    // pour un chemin __dirname simple côté appelant.
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          "powersync-worker": resolve("src/main/powersync/database.worker.ts")
        },
        // Déclarer plusieurs entrées désactive le mode "lib" mono-entrée
        // qu'electron-vite utilise pour déduire ses réglages par défaut —
        // format de sortie ET externalisation de "electron"/des modules
        // Node natifs (distincte d'externalizeDepsPlugin, qui ne lit que
        // "dependencies" du package.json — "electron" y est en
        // devDependency). Sans ceci, tout se retrouve embarqué dans le
        // bundle (vérifié par un vrai build : index.js passait de 5,6 Ko à
        // plus de 1 Mo, avec electron.exe lui-même tentant de se
        // "retélécharger" au lancement).
        //
        // Liste construite ici à la main plutôt que de compter sur la
        // fusion Vite avec le tableau externalisé par externalizeDepsPlugin
        // (plugins ci-dessous) : vérifié par un vrai build que ce tableau
        // REMPLACE celui du plugin plutôt que de s'y ajouter (@powersync/node
        // et better-sqlite3-multiple-ciphers se retrouvaient embarqués tant
        // que cette liste ne les incluait pas explicitement).
        external: [
          "electron",
          ...builtinModules,
          ...builtinModules.map((mod) => `node:${mod}`),
          ...runtimeDependencyNames
        ],
        output: {
          format: "cjs",
          entryFileNames: "[name].js"
        }
      }
    },
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
