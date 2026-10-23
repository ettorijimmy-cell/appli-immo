import { readFileSync } from "node:fs";
import type { RequestHandler } from "express";

const CSP_REGEX = /Content-Security-Policy"\s+content="([^"]+)"/i;

// Lue une seule fois au montage, depuis le VRAI index.html construit par
// apps/mobile-web (vite.config.ts, cspPlugin) — jamais dupliquée en dur
// ici : une seule source de vérité pour la politique, pas deux CSP
// susceptibles de diverger silencieusement si l'une change sans l'autre.
// Jamais d'exception si le fichier est absent ou le motif introuvable
// (build absent, format inattendu) : l'en-tête CSP est alors simplement
// omis, X-Content-Type-Options reste lui toujours posé.
function lireCspDepuisIndex(cheminIndex: string): string | undefined {
  try {
    const html = readFileSync(cheminIndex, "utf8");
    return CSP_REGEX.exec(html)?.[1];
  } catch {
    return undefined;
  }
}

// Posé en PREMIER dans la chaîne /mobile (voir mobile-web.ts), avant le
// verrou Basic Auth : s'applique ainsi à TOUTE réponse sous /mobile, y
// compris le 401/503 du verrou — un en-tête de réponse HTTP s'applique
// uniformément quel que soit le gestionnaire qui termine la requête,
// contrairement à la balise <meta> d'index.html qui ne protège que le
// document HTML lui-même (jamais une réponse JSON d'erreur).
export function creerEntetesSecurite(cheminIndex: string): RequestHandler {
  const csp = lireCspDepuisIndex(cheminIndex);

  return (_req, res, next) => {
    if (csp) {
      res.setHeader("Content-Security-Policy", csp);
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  };
}
