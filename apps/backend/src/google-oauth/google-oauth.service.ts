import { randomUUID } from "crypto";
import { BadGatewayException, BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { connexionGmail, mettreAJourAvecAudit, type Database } from "db";
import { and, eq, isNull } from "drizzle-orm";
import { AuditService } from "../audit/audit.service";
import { RequestContextService } from "../common/request-context";
import { EncryptionService } from "../crypto/encryption.service";
import { DATABASE_CONNECTION } from "../database/database.module";
import { UsersService } from "../users/users.service";
import { construireMessageRfc2822, type PieceJointeEmail } from "./construire-message-rfc2822";
import { GmailReconnexionRequiseException } from "./gmail-reconnexion-requise.exception";

// gmail.send : scope sensible mais non restreint (config Google Cloud
// confirmée par le propriétaire) — jamais gmail.readonly/modify, l'API
// n'a besoin que d'envoyer, jamais de lire la boîte de réception.
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
// openid/email : scopes non sensibles (aucune review Google requise),
// ajoutés uniquement pour obtenir un id_token au moment de l'échange de
// code — gmail.send seul ne donne accès à aucun endpoint de lecture,
// pas même users.getProfile (voir docs/backlog.md, dette technique
// 2026-09-01 : recupererEmailCompte échouait en 403 avec gmail.send seul,
// remplacé par le décodage de l'id_token ci-dessous).
const SCOPES = `openid email ${GMAIL_SCOPE}`;
const URL_AUTORISATION = "https://accounts.google.com/o/oauth2/v2/auth";
const URL_JETON = "https://oauth2.googleapis.com/token";
const URL_ENVOI = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
// Purpose distinct des JWT applicatifs classiques (sub/email) : le state
// OAuth ne doit jamais être confondu avec un jeton d'authentification, même
// s'il est signé avec le même secret (JWT_SECRET, réutilisation demandée —
// pas un nouveau secret à provisionner).
const STATE_PURPOSE = "gmail_oauth_state";
const STATE_EXPIRES_IN = "5m";
// Marge avant expiration réelle : un accès valide encore 60s pourrait
// expirer pendant l'appel Gmail lui-même — rafraîchi par anticipation.
const MARGE_EXPIRATION_MS = 60_000;

interface JetonsGoogle {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scope: string;
  // Présent uniquement à l'échange initial du code (scope openid demandé) —
  // jamais renvoyé par rafraichirJeton (grant_type=refresh_token), inutile
  // à ce moment-là (emailCompte déjà connu).
  idToken: string | null;
}

// Payload OpenID Connect minimal utilisé ici — email uniquement, jamais
// vérifié cryptographiquement (pas de récupération des clés publiques
// Google/JWKS) : l'id_token est obtenu directement depuis URL_JETON en
// HTTPS serveur-à-serveur, jamais transmis par le client ni exposé à une
// falsification possible — Google documente explicitement ce cas comme
// dispensé de vérification de signature (contrairement à un id_token reçu
// côté client, qui doit toujours être vérifié).
interface IdTokenPayload {
  email?: string;
}

interface StatePayload {
  organisationId: string;
  nonce: string;
  purpose: string;
}

export interface StatutGmail {
  connecte: boolean;
  emailCompte: string | null;
}

@Injectable()
export class GoogleOAuthService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly encryptionService: EncryptionService,
    private readonly auditService: AuditService,
    private readonly requestContext: RequestContextService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService
  ) {}

  private clientId(): string {
    return this.exigerVariable("GOOGLE_CLIENT_ID");
  }

  private clientSecret(): string {
    return this.exigerVariable("GOOGLE_CLIENT_SECRET");
  }

  private redirectUri(): string {
    return (
      this.config.get<string>("GOOGLE_REDIRECT_URI") ?? "http://localhost:3000/gmail/callback"
    );
  }

  // Échec bruyant en production plutôt qu'un appel Google voué à échouer
  // avec un message opaque — même principe que JWT_SECRET/ENCRYPTION_KEY
  // (auth.module.ts, crypto/encryption.service.ts).
  private exigerVariable(nom: string): string {
    const valeur = this.config.get<string>(nom);
    if (!valeur && process.env.NODE_ENV === "production") {
      throw new Error(`${nom} doit être défini en production (voir .env.example).`);
    }
    return valeur ?? `dev-${nom.toLowerCase()}-non-configure`;
  }

  private async resoudreOrganisationId(utilisateurId: string): Promise<string> {
    const utilisateur = await this.usersService.findById(utilisateurId);
    if (!utilisateur) {
      throw new NotFoundException("Utilisateur introuvable");
    }
    return utilisateur.organisationId;
  }

  async genererUrlConsentement(utilisateurId: string): Promise<string> {
    const organisationId = await this.resoudreOrganisationId(utilisateurId);

    // Jeton signé (JwtService, même secret que les JWT applicatifs) plutôt
    // qu'un stockage serveur intermédiaire — stateless, aucune table de
    // sessions OAuth à gérer. Courte durée de vie : protection CSRF, un
    // state volé ne reste exploitable que quelques minutes.
    const payload: StatePayload = { organisationId, nonce: randomUUID(), purpose: STATE_PURPOSE };
    const state = await this.jwtService.signAsync(payload, { expiresIn: STATE_EXPIRES_IN });

    const params = new URLSearchParams({
      client_id: this.clientId(),
      redirect_uri: this.redirectUri(),
      response_type: "code",
      scope: SCOPES,
      // offline + consent : force la réémission d'un refresh_token même en
      // cas de reconsentement (Google ne le renvoie sinon qu'à la toute
      // première autorisation) — sans ça, une reconnexion échouerait
      // silencieusement à obtenir un nouveau refresh_token exploitable.
      access_type: "offline",
      prompt: "consent",
      state
    });
    return `${URL_AUTORISATION}?${params.toString()}`;
  }

  /**
   * Traite le callback Google (code + state) : vérifie la signature/
   * fraîcheur du state, échange le code contre les jetons, chiffre et
   * upsert dans connexion_gmail. Une reconnexion (organisation déjà
   * connectée) archive l'ancienne ligne active avant d'insérer la
   * nouvelle — jamais modifiée en place (historique conservé, même
   * principe que revision_loyer).
   */
  async traiterCallback(code: string, state: string): Promise<{ emailCompte: string }> {
    let payload: StatePayload;
    try {
      payload = await this.jwtService.verifyAsync<StatePayload>(state);
    } catch {
      throw new BadRequestException(
        "Le paramètre state est invalide ou a expiré — relancez la connexion Gmail depuis Paramètres."
      );
    }
    if (payload.purpose !== STATE_PURPOSE || !payload.organisationId) {
      throw new BadRequestException("Paramètre state invalide.");
    }

    const jetons = await this.echangerCodeContreJetons(code);
    if (!jetons.refreshToken) {
      // Ne devrait jamais arriver avec access_type=offline + prompt=consent
      // — signal explicite plutôt qu'un stockage silencieux d'une chaîne
      // vide qui échouerait bien plus tard, au premier rafraîchissement.
      throw new BadRequestException(
        "Google n'a renvoyé aucun refresh_token — reconnexion impossible, réessayez."
      );
    }
    if (!jetons.idToken) {
      // Ne devrait jamais arriver avec le scope openid demandé — signal
      // explicite plutôt qu'un emailCompte vide stocké silencieusement.
      throw new BadRequestException(
        "Google n'a renvoyé aucun id_token — reconnexion impossible, réessayez."
      );
    }
    const emailCompte = this.decoderEmailDepuisIdToken(jetons.idToken);

    await this.db.transaction(async (tx) => {
      await tx
        .update(connexionGmail)
        .set({ archivedAt: new Date() })
        .where(and(eq(connexionGmail.organisationId, payload.organisationId), isNull(connexionGmail.archivedAt)));

      await tx.insert(connexionGmail).values({
        organisationId: payload.organisationId,
        emailCompte,
        accessTokenChiffre: this.encryptionService.encrypt(jetons.accessToken),
        refreshTokenChiffre: this.encryptionService.encrypt(jetons.refreshToken as string),
        expiresAt: new Date(Date.now() + jetons.expiresIn * 1000),
        scope: jetons.scope
      });
    });

    return { emailCompte };
  }

  async obtenirStatut(utilisateurId: string): Promise<StatutGmail> {
    const organisationId = await this.resoudreOrganisationId(utilisateurId);
    const connexion = await this.trouverConnexionActive(organisationId);
    return connexion ? { connecte: true, emailCompte: connexion.emailCompte } : { connecte: false, emailCompte: null };
  }

  /**
   * Retourne un access token valide pour l'organisation, en le
   * rafraîchissant si nécessaire (jamais rendu au-delà de sa vraie
   * expiration). Si le rafraîchissement échoue (jeton révoqué,
   * invalid_grant) : archive la connexion et lève
   * GmailReconnexionRequiseException — jamais une erreur générique, le
   * frontend doit pouvoir distinguer ce cas précis.
   */
  async obtenirAccessTokenValide(organisationId: string): Promise<string> {
    const connexion = await this.trouverConnexionActive(organisationId);
    if (!connexion) {
      throw new GmailReconnexionRequiseException("Aucune connexion Gmail active pour cette organisation.");
    }

    const utilisateurId = this.requestContext.getUtilisateurId();
    if (utilisateurId) {
      await this.auditService.logAccesDonneeSensible({
        entiteType: "connexion_gmail",
        entiteId: connexion.id,
        utilisateurId
      });
    }

    if (connexion.expiresAt.getTime() > Date.now() + MARGE_EXPIRATION_MS) {
      return this.encryptionService.decrypt(connexion.accessTokenChiffre);
    }

    const refreshToken = this.encryptionService.decrypt(connexion.refreshTokenChiffre);
    try {
      const jetons = await this.rafraichirJeton(refreshToken);
      await mettreAJourAvecAudit(
        this.db,
        connexionGmail,
        connexion.id,
        {
          accessTokenChiffre: this.encryptionService.encrypt(jetons.accessToken),
          expiresAt: new Date(Date.now() + jetons.expiresIn * 1000)
        },
        utilisateurId
      );
      return jetons.accessToken;
    } catch {
      await mettreAJourAvecAudit(this.db, connexionGmail, connexion.id, { archivedAt: new Date() }, utilisateurId);
      throw new GmailReconnexionRequiseException(
        "La connexion Gmail a expiré ou a été révoquée — reconnexion nécessaire depuis Paramètres."
      );
    }
  }

  async envoyerEmail(
    organisationId: string,
    destinataire: string,
    objet: string,
    corps: string,
    pieceJointe?: PieceJointeEmail
  ): Promise<void> {
    const connexion = await this.trouverConnexionActive(organisationId);
    if (!connexion) {
      throw new GmailReconnexionRequiseException("Aucune connexion Gmail active pour cette organisation.");
    }
    const accessToken = await this.obtenirAccessTokenValide(organisationId);

    const message = construireMessageRfc2822({
      from: connexion.emailCompte,
      to: destinataire,
      objet,
      corps,
      ...(pieceJointe ? { pieceJointe } : {})
    });
    const raw = Buffer.from(message).toString("base64url");

    const reponse = await fetch(URL_ENVOI, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw })
    });
    if (!reponse.ok) {
      // BadGatewayException (pas une Error générique) : sans filtre
      // d'exception personnalisé, NestJS masque le message d'une Error non
      // gérée derrière un "Internal server error" 500 générique — le
      // frontend a besoin du vrai message ("message d'erreur clair",
      // consigne explicite). Jamais accessToken/refreshToken dans ce
      // message (CLAUDE.md) — seul le statut et le corps d'erreur Gmail,
      // qui ne contiennent aucun secret.
      const texteErreur = await reponse.text();
      throw new BadGatewayException(`Échec de l'envoi via l'API Gmail (statut ${reponse.status}) : ${texteErreur}`);
    }
  }

  private async trouverConnexionActive(organisationId: string) {
    const [connexion] = await this.db
      .select()
      .from(connexionGmail)
      .where(and(eq(connexionGmail.organisationId, organisationId), isNull(connexionGmail.archivedAt)))
      .limit(1);
    return connexion ?? null;
  }

  private async echangerCodeContreJetons(code: string): Promise<JetonsGoogle> {
    const reponse = await fetch(URL_JETON, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.clientId(),
        client_secret: this.clientSecret(),
        redirect_uri: this.redirectUri(),
        grant_type: "authorization_code"
      }).toString()
    });
    if (!reponse.ok) {
      throw new BadRequestException("Échec de l'échange du code d'autorisation auprès de Google.");
    }
    const donnees = (await reponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
      id_token?: string;
    };
    return {
      accessToken: donnees.access_token,
      refreshToken: donnees.refresh_token ?? null,
      expiresIn: donnees.expires_in,
      scope: donnees.scope,
      idToken: donnees.id_token ?? null
    };
  }

  // Le refresh token n'est PAS renvoyé par Google lors d'un simple
  // rafraîchissement (uniquement à la toute première autorisation, ou une
  // reconnexion avec prompt=consent) — celui déjà stocké reste valide et
  // n'est jamais écrasé ici.
  private async rafraichirJeton(refreshToken: string): Promise<JetonsGoogle> {
    const reponse = await fetch(URL_JETON, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: this.clientId(),
        client_secret: this.clientSecret(),
        grant_type: "refresh_token"
      }).toString()
    });
    if (!reponse.ok) {
      throw new Error(`Échec du rafraîchissement du jeton Google (statut ${reponse.status})`);
    }
    const donnees = (await reponse.json()) as { access_token: string; expires_in: number; scope: string };
    return {
      accessToken: donnees.access_token,
      refreshToken: null,
      expiresIn: donnees.expires_in,
      scope: donnees.scope,
      idToken: null
    };
  }

  // Décode (sans vérification de signature — voir IdTokenPayload ci-dessus)
  // le claim `email` d'un id_token OpenID Connect obtenu directement depuis
  // URL_JETON. Remplace l'ancien appel à users.getProfile (gmail.send seul
  // n'y donne pas accès, voir docs/backlog.md, dette technique 2026-09-01).
  private decoderEmailDepuisIdToken(idToken: string): string {
    const segments = idToken.split(".");
    const segmentPayload = segments[1];
    if (segments.length !== 3 || !segmentPayload) {
      throw new BadRequestException("id_token Google invalide.");
    }
    let payload: IdTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(segmentPayload, "base64url").toString("utf8")) as IdTokenPayload;
    } catch {
      throw new BadRequestException("id_token Google invalide.");
    }
    if (!payload.email) {
      throw new BadRequestException("id_token Google ne contient aucune adresse email.");
    }
    return payload.email;
  }
}
