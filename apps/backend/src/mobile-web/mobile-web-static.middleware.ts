import { existsSync } from "node:fs";
import { join } from "node:path";
import express, { type RequestHandler } from "express";

// Dernier segment de l'URL se terminant par une extension (ex.
// /mobile/assets/ancien.js, /mobile/favicon.ico) : jamais de repli SPA sur
// un chemin qui RESSEMBLE à un fichier — absent du disque, c'est une
// ressource manquante (asset périmé après un déploiement, favicon,
// faute de frappe...), pas une route de l'appli React
// (/mobile/baux/123, sans extension). Seul le dernier segment compte :
// un point ailleurs dans le chemin (improbable ici) n'a pas d'incidence.
export function ressembleAUnFichier(pathname: string): boolean {
  const dernierSegment = pathname.split("/").pop() ?? "";
  return /\.[^./]+$/.test(dernierSegment);
}

// Fichiers statiques (assets à nom d'empreinte, voir vite.config.ts,
// base/rollup) + repli SPA (une vraie route de l'appli React renvoie
// index.html avec 200, ex. /mobile/bail/123 après rechargement) — même
// principe que `try_files $uri /index.html` en nginx.
//
// index: false — express.static ne sert JAMAIS index.html lui-même (son
// repli automatique habituel sur "/") : c'est TOUJOURS le gestionnaire
// ci-dessous qui s'en charge, avec son propre Cache-Control explicite.
// Sans ce réglage, "/" serait résolu par deux chemins de code différents
// (express.static avec ses en-têtes par défaut, et ce gestionnaire avec
// les siens) — risque de divergence silencieuse.
//
// maxAge/immutable : tout ce que ce middleware sert désormais (puisque
// index.html en est exclu) porte un nom de fichier à empreinte
// (ex. assets/index-DA4rMtP-.js) — jamais réutilisé pour un contenu
// différent, donc jamais besoin de revalider : cache long (1 an) et
// immutable sans risque de servir une version obsolète.
export function creerMiddlewareStatique(distDir: string): RequestHandler[] {
  const cheminIndex = join(distDir, "index.html");

  return [
    express.static(distDir, { index: false, maxAge: "1y", immutable: true }),
    (req, res) => {
      // express.static (ci-dessus) ne traite déjà que GET/HEAD et laisse
      // passer toute autre méthode — jamais de repli SPA sur une méthode
      // différente, qui n'a pas de sens pour une page HTML statique.
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.setHeader("Allow", "GET, HEAD");
        res.status(405).json({ statusCode: 405, message: "Méthode non autorisée." });
        return;
      }

      if (ressembleAUnFichier(req.path)) {
        res.status(404).json({ statusCode: 404, message: "Fichier introuvable." });
        return;
      }

      if (!existsSync(cheminIndex)) {
        // Build mobile-web absent de l'image (voir Dockerfile) : 503
        // explicite plutôt qu'une exception non gérée par res.sendFile()
        // — l'API ne doit jamais être affectée par un problème propre à
        // /mobile.
        res.status(503).json({
          statusCode: 503,
          message: "Application mobile indisponible (build absent)."
        });
        return;
      }

      // Jamais mis en cache : une nouvelle version doit être prise
      // immédiatement au prochain chargement (voir docs/backlog.md) —
      // contrairement aux assets à empreinte ci-dessus.
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(cheminIndex);
    }
  ];
}
