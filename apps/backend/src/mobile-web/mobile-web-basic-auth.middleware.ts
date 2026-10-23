import { createHash, timingSafeEqual } from "node:crypto";
import { Logger } from "@nestjs/common";
import type { NextFunction, Request, RequestHandler, Response } from "express";

const REALM = "appli-immo-mobile";

export interface ConfigVerrouBasicAuth {
  actif: boolean;
  utilisateur: string | undefined;
  motDePasse: string | undefined;
}

// Lue une seule fois, au montage (voir mobile-web.ts) — ni la lecture de
// process.env ni ce qui en découle ne doit jamais faire échouer le
// démarrage du backend : l'API doit continuer de fonctionner même si ce
// verrou est mal configuré ou manquant (voir creerVerrouBasicAuth, 503
// plutôt qu'une exception). MOBILE_WEB_BASIC_AUTH_ENABLED=false désactive
// totalement le verrou — prévu pour le jour où /mobile sera ouvert à des
// clients authentifiés par leur propre compte (voir docs/backlog.md,
// chemin de migration).
export function lireConfigVerrouDepuisEnv(env: NodeJS.ProcessEnv): ConfigVerrouBasicAuth {
  return {
    actif: env["MOBILE_WEB_BASIC_AUTH_ENABLED"] !== "false",
    utilisateur: env["MOBILE_WEB_BASIC_AUTH_USER"],
    motDePasse: env["MOBILE_WEB_BASIC_AUTH_PASSWORD"]
  };
}

// Comparaison à temps constant : jamais `a === b` ni `timingSafeEqual`
// directement sur les chaînes brutes (ces dernières peuvent différer en
// longueur, ce que timingSafeEqual refuse — lever puis intercepter cette
// exception réintroduirait un canal temporel/de contrôle révélant que les
// longueurs diffèrent). Hacher d'abord (SHA-256, toujours 32 octets)
// élimine le problème de longueur à la racine, pas seulement l'exception.
function comparerATempsConstant(valeurRecue: string, valeurAttendue: string): boolean {
  const hacheRecu = createHash("sha256").update(valeurRecue, "utf8").digest();
  const hacheAttendu = createHash("sha256").update(valeurAttendue, "utf8").digest();
  return timingSafeEqual(hacheRecu, hacheAttendu);
}

interface Identifiants {
  utilisateur: string;
  motDePasse: string;
}

// Scission sur le PREMIER ':' seulement : la spécification HTTP Basic
// (RFC 7617) autorise un mot de passe contenant ':', jamais le
// user-id — un split naïf sur tous les ':' couperait un mot de passe
// légitime.
function extraireIdentifiants(enTeteAutorisation: string | undefined): Identifiants | null {
  if (!enTeteAutorisation || !enTeteAutorisation.startsWith("Basic ")) {
    return null;
  }
  let decode: string;
  try {
    decode = Buffer.from(enTeteAutorisation.slice("Basic ".length), "base64").toString("utf8");
  } catch {
    return null;
  }
  const indexSeparateur = decode.indexOf(":");
  if (indexSeparateur === -1) {
    return null;
  }
  return {
    utilisateur: decode.slice(0, indexSeparateur),
    motDePasse: decode.slice(indexSeparateur + 1)
  };
}

// Même mécanisme que adresseIpReelle (auth.controller.ts) mais dupliqué
// ici délibérément, pas importé : ce module doit rester retirable sans
// toucher à apps/backend/src/auth (voir docs/backlog.md, condition de
// réversibilité de l'hébergement sous /mobile/).
function adresseIp(request: Request): string {
  const enTete = request.headers["x-real-ip"];
  if (typeof enTete === "string" && enTete.length > 0) {
    return enTete;
  }
  return request.ip ?? "adresse inconnue";
}

function repondreJson(res: Response, statut: number, message: string): void {
  res.status(statut).json({ statusCode: statut, message });
}

// Verrou HTTP Basic devant /mobile UNIQUEMENT (monté sur ce préfixe par
// mobile-web.ts) — jamais sur les routes d'API, qui restent gouvernées par
// JwtAuthGuard. Le WWW-Authenticate posé ci-dessous sur un 401 n'appartient
// qu'à CE verrou ; un 401 de l'API (JwtAuthGuard, ailleurs) n'en pose
// jamais — sinon le navigateur afficherait la fenêtre native Basic Auth
// sur une simple erreur d'API (vérifié par test d'intégration réel).
export function creerVerrouBasicAuth(config: ConfigVerrouBasicAuth): RequestHandler {
  const logger = new Logger("Auth");
  const configValide = Boolean(config.utilisateur) && Boolean(config.motDePasse);

  return (req: Request, res: Response, next: NextFunction) => {
    if (!config.actif) {
      next();
      return;
    }

    if (!configValide) {
      // Jamais un crash au démarrage pour une variable d'environnement
      // manquante : seul /mobile est indisponible, l'API continue de
      // fonctionner normalement (voir docs/backlog.md).
      repondreJson(res, 503, "Accès mobile temporairement indisponible (configuration du verrou incomplète).");
      return;
    }

    const identifiants = extraireIdentifiants(req.headers.authorization);
    const accordeUtilisateur = identifiants ? comparerATempsConstant(identifiants.utilisateur, config.utilisateur!) : false;
    const accordeMotDePasse = identifiants ? comparerATempsConstant(identifiants.motDePasse, config.motDePasse!) : false;

    if (!identifiants || !accordeUtilisateur || !accordeMotDePasse) {
      // IP en clair, jamais les identifiants tentés (ni corrects, ni
      // incorrects) — voir CLAUDE.md et le même principe déjà appliqué à
      // LimitationTentativesConnexionService.
      logger.warn(`Verrou /mobile refusé, IP=${adresseIp(req)}`);
      res.setHeader("WWW-Authenticate", `Basic realm="${REALM}"`);
      repondreJson(res, 401, "Authentification requise.");
      return;
    }

    next();
  };
}
