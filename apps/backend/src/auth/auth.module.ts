import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";

const DUREE_JWT_PAR_DEFAUT_SECONDES = 3600;

// ConfigService.get<number>(...) ne convertit jamais réellement la valeur —
// <number> n'est qu'une annotation TypeScript sans effet à l'exécution
// (ConfigService.getFromProcessEnv fait un simple lodash.get(process.env,
// clé), toujours une chaîne dès que la variable est définie). Transmettre
// cette chaîne telle quelle à signOptions.expiresIn change de branche dans
// jsonwebtoken (timespan.js) : une valeur numérique est traitée comme des
// SECONDES, une chaîne est traitée comme une durée `ms` — et `ms("3600")`
// (sans unité) vaut 3600 MILLISECONDES, soit environ 3 secondes une fois
// arrondi. Incident réel du 2026-09-28 : déconnexion ~3 secondes après
// chaque connexion en production, alors que
// la console Scaleway affichait "3600" en toutes lettres — aucune faute de
// frappe nécessaire, uniquement ce défaut de type. Number(...) impose la
// branche numérique quoi qu'il arrive ; repli sur la valeur par défaut si
// la variable est absente, vide, ou ne représente pas un nombre positif.
export function resoudreExpirationJwtSecondes(valeurBrute: string | undefined): number {
  const nombre = Number(valeurBrute);
  return valeurBrute && Number.isFinite(nombre) && nombre > 0 ? nombre : DUREE_JWT_PAR_DEFAUT_SECONDES;
}

// Instance capturée pour pouvoir être ré-exportée : exporter JwtAuthGuard
// seul n'exporte pas transitivement sa propre dépendance JwtService. Sans
// ce ré-export, Nest ne peut pas (re)construire JwtAuthGuard pour un
// module consommateur (voir docs/error-log.md).
const jwtModule = JwtModule.registerAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const secret = config.get<string>("JWT_SECRET");

    // Échec bruyant plutôt qu'un repli silencieux vers un secret par
    // défaut en production (même principe que VITE_API_URL côté desktop
    // — voir docs/error-log.md). Le repli reste actif en dev uniquement.
    if (!secret && process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET doit être défini en production (voir .env.example).");
    }

    return {
      secret: secret ?? "dev-only-insecure-secret-change-me",
      signOptions: { expiresIn: resoudreExpirationJwtSecondes(config.get<string>("JWT_EXPIRES_IN_SECONDS")) }
    };
  }
});

// Global : JwtAuthGuard est une préoccupation transversale (voir
// docs/error-log.md) — tout futur module protégé par JWT doit pouvoir
// l'utiliser sans réimporter AuthModule à chaque fois.
//
// APP_GUARD enregistre JwtAuthGuard comme garde globale : échec sécurisé
// par défaut, toute route exige un JWT valide sauf décorée @Public()
// (voir public.decorator.ts et docs/data-dictionary.md, section
// Authentification). useExisting (pas useClass) pour réutiliser la même
// instance que le provider JwtAuthGuard ci-dessous, plutôt que d'en
// construire une seconde.
@Global()
@Module({
  imports: [UsersModule, jwtModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, { provide: APP_GUARD, useExisting: JwtAuthGuard }],
  exports: [JwtAuthGuard, jwtModule]
})
export class AuthModule {}
