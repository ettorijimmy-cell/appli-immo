import { randomUUID } from "crypto";
import { BadGatewayException, BadRequestException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test, type TestingModule } from "@nestjs/testing";
import { connexionGmail, createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, utilisateurs, type Database } from "db";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { CommonModule } from "../common/common.module";
import { EncryptionModule } from "../crypto/encryption.module";
import { EncryptionService } from "../crypto/encryption.service";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { GmailReconnexionRequiseException } from "./gmail-reconnexion-requise.exception";
import { GoogleOAuthModule } from "./google-oauth.module";
import { GoogleOAuthService } from "./google-oauth.service";

// Base réelle (organisation/utilisateur, chiffrement réel via
// EncryptionService, JwtService réel pour le state OAuth) mais fetch
// systématiquement mocké — jamais un vrai appel HTTP contre les endpoints
// Google/Gmail dans les tests automatisés (consigne explicite du chantier
// Gmail OAuth, Module Tâches Étape 3).
describe("GoogleOAuthService (intégration Postgres réelle, fetch mocké)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let googleOAuthService: GoogleOAuthService;
  let jwtService: JwtService;
  let db: Database;
  let organisationId: string;
  let userId: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    db = await begin();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        CommonModule,
        DatabaseModule,
        EncryptionModule,
        AuditModule,
        UsersModule,
        AuthModule,
        GoogleOAuthModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    googleOAuthService = moduleRef.get(GoogleOAuthService);
    jwtService = moduleRef.get(JwtService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation GoogleOAuth Intégration" })
      .returning();
    if (!organisation) throw new Error("Échec de l'insertion de l'organisation de test");
    organisationId = organisation.id;
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId,
        email: `google-oauth-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "GoogleOAuth",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) throw new Error("Échec de l'insertion de l'utilisateur de test");
    userId = user.id;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  function reponseJson(corps: unknown, ok = true): Response {
    return {
      ok,
      status: ok ? 200 : 400,
      json: async () => corps,
      text: async () => JSON.stringify(corps)
    } as unknown as Response;
  }

  // id_token factice — jamais vérifié cryptographiquement par le code testé
  // (voir IdTokenPayload, google-oauth.service.ts), seul le payload compte.
  function construireIdTokenFactice(payload: Record<string, unknown>): string {
    const encoderSegment = (valeur: unknown): string => Buffer.from(JSON.stringify(valeur)).toString("base64url");
    return `${encoderSegment({ alg: "RS256", typ: "JWT" })}.${encoderSegment(payload)}.signature-factice`;
  }

  async function creerConnexionActive(expiresDansSecondes: number): Promise<string> {
    const [connexion] = await db
      .insert(connexionGmail)
      .values({
        organisationId,
        emailCompte: "proprietaire@example.com",
        accessTokenChiffre: encrypterPourTest("access-token-initial"),
        refreshTokenChiffre: encrypterPourTest("refresh-token-initial"),
        expiresAt: new Date(Date.now() + expiresDansSecondes * 1000),
        scope: "https://www.googleapis.com/auth/gmail.send"
      })
      .returning();
    if (!connexion) throw new Error("Échec de l'insertion de la connexion de test");
    return connexion.id;
  }

  // EncryptionModule est @Global() (voir crypto/encryption.module.ts) — le
  // provider est donc résolvable directement depuis le moduleRef, même
  // clé de dev que le reste des tests d'intégration.
  function encrypterPourTest(valeur: string): string {
    return moduleRef.get(EncryptionService).encrypt(valeur);
  }

  it("genererUrlConsentement : construit une URL Google valide avec un state signé", async () => {
    const url = await googleOAuthService.genererUrlConsentement(userId);
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    // openid/email : ajoutés pour obtenir un id_token à l'échange de code
    // (gmail.send seul ne donne accès à aucun endpoint de lecture, pas même
    // users.getProfile — voir docs/backlog.md, dette technique 2026-09-01).
    expect(parsed.searchParams.get("scope")).toBe("openid email https://www.googleapis.com/auth/gmail.send");
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("prompt")).toBe("consent");

    const state = parsed.searchParams.get("state");
    expect(state).toBeTruthy();
    const payload = await jwtService.verifyAsync<{ organisationId: string; purpose: string }>(state as string);
    expect(payload.organisationId).toBe(organisationId);
    expect(payload.purpose).toBe("gmail_oauth_state");
  });

  it("traiterCallback : échange le code, décode l'id_token et enregistre la connexion", async () => {
    const state = await jwtService.signAsync(
      { organisationId, nonce: randomUUID(), purpose: "gmail_oauth_state" },
      { expiresIn: "5m" }
    );
    fetchMock.mockResolvedValueOnce(
      reponseJson({
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 3600,
        scope: "gmail.send",
        id_token: construireIdTokenFactice({ email: "proprietaire@example.com" })
      })
    );

    const resultat = await googleOAuthService.traiterCallback("code-autorisation", state);

    // Un seul appel HTTP (échange de code) — plus d'appel à
    // users.getProfile depuis la suppression de recupererEmailCompte.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resultat.emailCompte).toBe("proprietaire@example.com");
    const [connexion] = await db
      .select()
      .from(connexionGmail)
      .where(and(eq(connexionGmail.organisationId, organisationId), isNull(connexionGmail.archivedAt)));
    expect(connexion).toBeDefined();
    expect(connexion?.accessTokenChiffre).not.toBe("access-1");
    expect(connexion?.refreshTokenChiffre).not.toBe("refresh-1");

    const statut = await googleOAuthService.obtenirStatut(userId);
    expect(statut).toEqual({ connecte: true, emailCompte: "proprietaire@example.com" });
  });

  it("traiterCallback : une reconnexion archive l'ancienne ligne active plutôt que de la modifier", async () => {
    await creerConnexionActive(3600);
    const state = await jwtService.signAsync(
      { organisationId, nonce: randomUUID(), purpose: "gmail_oauth_state" },
      { expiresIn: "5m" }
    );
    fetchMock.mockResolvedValueOnce(
      reponseJson({
        access_token: "access-2",
        refresh_token: "refresh-2",
        expires_in: 3600,
        scope: "gmail.send",
        id_token: construireIdTokenFactice({ email: "nouveau-proprietaire@example.com" })
      })
    );

    await googleOAuthService.traiterCallback("code-autorisation", state);

    const lignes = await db.select().from(connexionGmail).where(eq(connexionGmail.organisationId, organisationId));
    expect(lignes).toHaveLength(2);
    const active = lignes.filter((l) => l.archivedAt === null);
    expect(active).toHaveLength(1);
    expect(active[0]?.emailCompte).toBe("nouveau-proprietaire@example.com");
  });

  it("traiterCallback : rejette un state invalide ou expiré", async () => {
    await expect(googleOAuthService.traiterCallback("code-autorisation", "state-invalide")).rejects.toThrow(
      BadRequestException
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("traiterCallback : rejette si Google ne renvoie aucun refresh_token", async () => {
    const state = await jwtService.signAsync(
      { organisationId, nonce: randomUUID(), purpose: "gmail_oauth_state" },
      { expiresIn: "5m" }
    );
    fetchMock.mockResolvedValueOnce(reponseJson({ access_token: "access-1", expires_in: 3600, scope: "gmail.send" }));

    await expect(googleOAuthService.traiterCallback("code-autorisation", state)).rejects.toThrow(BadRequestException);
  });

  it("traiterCallback : rejette si Google ne renvoie aucun id_token (scope openid manquant côté Google Cloud Console)", async () => {
    const state = await jwtService.signAsync(
      { organisationId, nonce: randomUUID(), purpose: "gmail_oauth_state" },
      { expiresIn: "5m" }
    );
    fetchMock.mockResolvedValueOnce(
      reponseJson({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600, scope: "gmail.send" })
    );

    await expect(googleOAuthService.traiterCallback("code-autorisation", state)).rejects.toThrow(BadRequestException);
  });

  it("traiterCallback : rejette un id_token malformé plutôt que de stocker un emailCompte vide", async () => {
    const state = await jwtService.signAsync(
      { organisationId, nonce: randomUUID(), purpose: "gmail_oauth_state" },
      { expiresIn: "5m" }
    );
    fetchMock.mockResolvedValueOnce(
      reponseJson({
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 3600,
        scope: "gmail.send",
        id_token: "pas-un-jwt-valide"
      })
    );

    await expect(googleOAuthService.traiterCallback("code-autorisation", state)).rejects.toThrow(BadRequestException);
  });

  it("obtenirAccessTokenValide : lève GmailReconnexionRequiseException si aucune connexion active", async () => {
    await expect(googleOAuthService.obtenirAccessTokenValide(organisationId)).rejects.toThrow(
      GmailReconnexionRequiseException
    );
  });

  it("obtenirAccessTokenValide : renvoie le jeton déchiffré sans rafraîchir s'il est encore valide", async () => {
    await creerConnexionActive(3600);

    const accessToken = await googleOAuthService.obtenirAccessTokenValide(organisationId);

    expect(accessToken).toBe("access-token-initial");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("obtenirAccessTokenValide : rafraîchit le jeton proche de l'expiration et persiste le nouveau", async () => {
    await creerConnexionActive(30); // sous la marge de 60s
    fetchMock.mockResolvedValueOnce(reponseJson({ access_token: "access-rafraichi", expires_in: 3600, scope: "gmail.send" }));

    const accessToken = await googleOAuthService.obtenirAccessTokenValide(organisationId);

    expect(accessToken).toBe("access-rafraichi");
    const [connexion] = await db
      .select()
      .from(connexionGmail)
      .where(and(eq(connexionGmail.organisationId, organisationId), isNull(connexionGmail.archivedAt)));
    expect(connexion).toBeDefined();
    // Google ne renvoie pas de nouveau refresh_token sur un simple
    // rafraîchissement — celui déjà stocké ne doit jamais être écrasé.
    const encryptionService = moduleRef.get(EncryptionService);
    expect(encryptionService.decrypt(connexion?.refreshTokenChiffre as string)).toBe("refresh-token-initial");
    expect(connexion?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 3000);
  });

  it("obtenirAccessTokenValide : archive la connexion et lève GmailReconnexionRequiseException si le rafraîchissement échoue", async () => {
    await creerConnexionActive(30);
    fetchMock.mockResolvedValueOnce(reponseJson({ error: "invalid_grant" }, false));

    await expect(googleOAuthService.obtenirAccessTokenValide(organisationId)).rejects.toThrow(
      GmailReconnexionRequiseException
    );

    const statut = await googleOAuthService.obtenirStatut(userId);
    expect(statut.connecte).toBe(false);
  });

  it("envoyerEmail : poste le message construit avec le jeton d'accès valide", async () => {
    await creerConnexionActive(3600);
    fetchMock.mockResolvedValueOnce(reponseJson({ id: "message-1" }));

    await googleOAuthService.envoyerEmail(organisationId, "locataire@example.com", "Objet", "Corps du message.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer access-token-initial");
  });

  it("envoyerEmail : lève BadGatewayException avec un message clair si l'API Gmail refuse l'envoi, sans jamais exposer le jeton", async () => {
    await creerConnexionActive(3600);
    fetchMock.mockResolvedValueOnce(reponseJson({ error: "insufficient permissions" }, false));

    let erreurCapturee: unknown;
    try {
      await googleOAuthService.envoyerEmail(organisationId, "locataire@example.com", "Objet", "Corps du message.");
    } catch (erreur) {
      erreurCapturee = erreur;
    }

    expect(erreurCapturee).toBeInstanceOf(BadGatewayException);
    const message = erreurCapturee instanceof Error ? erreurCapturee.message : String(erreurCapturee);
    expect(message).toContain("insufficient permissions");
    expect(message).not.toContain("access-token-initial");
  });

  it("envoyerEmail : lève GmailReconnexionRequiseException si aucune connexion active, sans appeler l'API", async () => {
    await expect(
      googleOAuthService.envoyerEmail(organisationId, "locataire@example.com", "Objet", "Corps du message.")
    ).rejects.toThrow(GmailReconnexionRequiseException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
