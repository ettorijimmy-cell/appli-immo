import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { creerVerrouBasicAuth, lireConfigVerrouDepuisEnv } from "./mobile-web-basic-auth.middleware";
import { creerEntetesSecurite } from "./mobile-web-security-headers.middleware";
import { creerMiddlewareStatique } from "./mobile-web-static.middleware";

export const PREFIXE_MOBILE_WEB = "/mobile";

// Monte apps/mobile-web sous /mobile, en middleware Express brut via
// INestApplication.use() — JAMAIS un contrôleur ni un module Nest
// (@nestjs/serve-static notamment) : un contrôleur passerait par le
// routeur Nest et donc par JwtAuthGuard (APP_GUARD global, voir
// auth.module.ts), qu'on veut justement ne jamais déclencher ici.
// Un middleware monté sur ce seul préfixe répond directement (verrou
// Basic Auth puis fichiers statiques/repli SPA) sans jamais atteindre le
// routeur Nest ni risquer de collision avec une route d'API — vérifié par
// test d'intégration réel (mobile-web.spec.ts).
//
// IMPÉRATIF, vérifié empiriquement (pas supposé) : cet appel doit avoir
// lieu AVANT que le routeur Nest soit initialisé (donc avant tout
// app.init() explicite, et dans main.ts entre NestFactory.create() et
// app.listen() — jamais après). Une fois ce routeur initialisé, toute
// route non mappée par un contrôleur produit directement un 404 JSON (le
// NotFoundException interne de Nest, qui écrit la réponse lui-même) :
// elle ne "retombe" jamais sur un middleware ajouté après coup via
// app.use(), contrairement à ce qu'on pourrait attendre d'Express seul.
// Appeler monterMobileWeb() après app.init()/app.listen() rendrait /mobile
// silencieusement 404 sur tout, sans aucune erreur au démarrage.
//
// Isolé dans ce seul dossier : retirer l'hébergement sous /mobile revient
// à supprimer apps/backend/src/mobile-web/ et l'appel ci-dessous dans
// main.ts, rien d'autre à toucher (voir docs/backlog.md, condition de
// réversibilité).
export function monterMobileWeb(app: INestApplication, distDir: string): void {
  // Posés en premier, avant le verrou : s'appliquent à TOUTE réponse sous
  // /mobile, y compris le 401/503 produit par le verrou lui-même (voir
  // mobile-web-security-headers.middleware.ts).
  const entetesSecurite = creerEntetesSecurite(join(distDir, "index.html"));
  const verrou = creerVerrouBasicAuth(lireConfigVerrouDepuisEnv(process.env));
  const [servirStatique, replisSpa] = creerMiddlewareStatique(distDir);
  app.use(PREFIXE_MOBILE_WEB, entetesSecurite, verrou, servirStatique!, replisSpa!);
}
