import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SignJWT } from "jose";

export interface PowerSyncCredentials {
  token: string;
  endpoint: string;
}

// Jeton PowerSync distinct du JWT applicatif NestJS (secret HS256 dédié,
// configuré dans le dashboard PowerSync — voir docs/data-dictionary.md,
// section Authentification). Vérification volontairement paresseuse (dans
// emettreCredentials, pas le constructeur) : contrairement à
// JWT_SECRET/ENCRYPTION_KEY, ce secret n'a pas de repli de développement
// possible (il doit correspondre à un compte PowerSync externe réel), mais
// PowerSyncModule est importé globalement dans AppModule — vérifier au
// démarrage empêcherait `pnpm dev` de booter pour tout développement sans
// rapport avec PowerSync, tant que ces 3 variables ne sont pas configurées.
// L'échec bruyant n'intervient donc que si l'endpoint est réellement appelé.
@Injectable()
export class PowerSyncService {
  constructor(private readonly config: ConfigService) {}

  async emettreCredentials(userId: string): Promise<PowerSyncCredentials> {
    const secretBase64Url = this.config.get<string>("POWERSYNC_JWT_SECRET");
    const kid = this.config.get<string>("POWERSYNC_JWT_KID");
    const endpoint = this.config.get<string>("POWERSYNC_URL");

    if (!secretBase64Url || !kid || !endpoint) {
      throw new Error(
        "POWERSYNC_JWT_SECRET, POWERSYNC_JWT_KID et POWERSYNC_URL doivent être définies (voir .env.example)."
      );
    }

    const secret = Buffer.from(secretBase64Url, "base64url");
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256", kid })
      .setSubject(userId)
      .setIssuer("appli-immo-backend")
      .setAudience(endpoint)
      .setIssuedAt()
      .setExpirationTime("60m")
      .sign(secret);

    return { token, endpoint };
  }
}
