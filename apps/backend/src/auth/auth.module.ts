import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";

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
      signOptions: { expiresIn: config.get<number>("JWT_EXPIRES_IN_SECONDS", 3600) }
    };
  }
});

// Global : JwtAuthGuard est une préoccupation transversale (voir
// docs/error-log.md) — tout futur module protégé par JWT doit pouvoir
// l'utiliser sans réimporter AuthModule à chaque fois.
@Global()
@Module({
  imports: [UsersModule, jwtModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [JwtAuthGuard, jwtModule]
})
export class AuthModule {}
