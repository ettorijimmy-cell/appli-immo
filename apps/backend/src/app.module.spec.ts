import "reflect-metadata";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { AppModule } from "./app.module";
import { GoogleOAuthModule } from "./google-oauth/google-oauth.module";

// Désactivation du module Gmail OAuth dormant (décision actée avec Jimmy,
// 2026-09-22, docs/data-dictionary.md section "Gmail") : le mécanisme de
// désactivation choisi est le retrait de GoogleOAuthModule des imports
// d'AppModule, pas un guard ni un flag d'environnement — voir le
// commentaire dans app.module.ts pour la justification complète. Ce test
// vérifie directement ce mécanisme (lecture de la métadonnée @Module
// d'AppModule, sans démarrer de serveur HTTP ni de connexion base — aucune
// infrastructure de test HTTP/supertest n'existe dans ce backend, cohérent
// avec les conventions déjà en place) : GoogleOAuthModule absent des
// imports garantit que Nest n'instancie jamais GoogleOAuthController, donc
// qu'aucune des 3 routes /gmail/* (y compris le callback @Public(), non
// protégé par JwtAuthGuard) n'est jamais enregistrée, quelle que soit la
// requête.
describe("AppModule — désactivation du module Gmail OAuth", () => {
  it("n'importe plus GoogleOAuthModule (routes /gmail/* jamais enregistrées, y compris le callback @Public())", () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as unknown[];
    expect(imports).toBeDefined();
    expect(imports).not.toContain(GoogleOAuthModule);
  });
});
