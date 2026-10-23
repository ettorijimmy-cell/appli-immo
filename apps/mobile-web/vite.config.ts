import { resolve } from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

const CSP_PLACEHOLDER = "__CSP__";

// CSP posée au build, sur le modèle de apps/desktop/electron.vite.config.ts
// (cspPlugin). connect-src suit la même résolution que
// src/lib/api-config.ts (resoudreApiBaseUrl) : 'self' seul par défaut en
// production (même origine que le backend, sous /mobile/ — voir
// docs/backlog.md) ; une origine complète s'ajoute si VITE_API_URL en
// définit une (réversibilité vers un hébergement séparé). En dev, ajoute
// http://localhost:3000 (repli par défaut de api-config.ts) et autorise
// les styles inline injectés par le client HMR de Vite — jamais présents
// dans le build livré, donc sans impact sur la sécurité de l'app servie.
function cspPlugin(): Plugin {
  let isDev = false;
  let envApiUrl: string | undefined;
  return {
    name: "appli-immo-mobile-csp",
    configResolved(config) {
      isDev = config.command === "serve";
      envApiUrl = config.env["VITE_API_URL"] as string | undefined;
    },
    transformIndexHtml(html) {
      const origineApiAbsolue = envApiUrl || (isDev ? "http://localhost:3000" : undefined);
      const connectSrc = origineApiAbsolue ? `'self' ${origineApiAbsolue}` : "'self'";
      const csp = isDev
        ? `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src ${connectSrc}`
        : `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src ${connectSrc}`;
      // Recherche d'un placeholder littéral, insensible à toute mise en
      // forme HTML environnante — échec bruyant si absent plutôt qu'un
      // remplacement silencieusement ignoré (voir docs/error-log.md, même
      // raison que apps/desktop/electron.vite.config.ts).
      if (!html.includes(CSP_PLACEHOLDER)) {
        throw new Error(`${CSP_PLACEHOLDER} introuvable dans index.html : la CSP ne serait pas appliquée.`);
      }
      return html.replaceAll(CSP_PLACEHOLDER, csp);
    }
  };
}

export default defineConfig(({ command }) => ({
  // Lit le .env à la racine du monorepo (un seul fichier .env pour tout le
  // projet), même convention que apps/desktop.
  envDir: resolve("../.."),
  // Préfixe de montage, réglable par MOBILE_WEB_BASE_PATH pour pouvoir
  // servir l'appli à la racine ("/") le jour d'un hébergement séparé, sans
  // toucher au code — seul endroit où le préfixe actuel ("/mobile/",
  // sous-chemin du backend, voir docs/backlog.md) est écrit ; App.tsx le
  // lit en retour via import.meta.env.BASE_URL (resoudreBasename), jamais
  // redéfini. Lu directement sur process.env (pas via .env/envDir) : c'est
  // une variable d'outillage du build, jamais exposée au code client (pas
  // de préfixe VITE_) — injectée par le script de déploiement au même
  // titre que VITE_API_URL. En dev, reste "/" : le serveur Vite sert à la
  // racine, inchangé.
  base: command === "build" ? (process.env["MOBILE_WEB_BASE_PATH"] ?? "/mobile/") : "/",
  plugins: [react(), cspPlugin()],
  build: {
    // Jamais de source map dans un build servi publiquement — le bundle
    // contient déjà tout le code client en clair (voir audit hébergement
    // mobile-web, docs/backlog.md), pas la peine d'y ajouter le mapping
    // vers les fichiers source originaux. Vite ne les génère pas par
    // défaut ; explicite pour que ça ne dépende jamais d'une valeur par
    // défaut externe susceptible de changer.
    sourcemap: false
  },
  // host: true écoute sur 0.0.0.0 (toutes les interfaces), pas seulement
  // localhost — nécessaire pour ouvrir le parcours de capture depuis un
  // téléphone sur le même réseau local pendant les visites.
  server: { host: true }
}));
